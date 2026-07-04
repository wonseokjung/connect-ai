#!/usr/bin/env python3
"""deploy_cli — Vercel/Netlify CLI 로 정적 사이트를 공개 배포. deploy_cli_v1.

5단계 오더 파이프라인의 ⑤운영 단계에서 <run_command>python deploy_cli.py ...</run_command>
로 호출. site/ 폴더를 공개 URL 로 만든다. 토큰이 없으면 친화적 안내 후 exit 0 (운영 중단 방지).

사용:
  python deploy_cli.py --provider vercel --dir /path/to/site
  python deploy_cli.py --provider netlify --dir /path/to/site
  python deploy_cli.py --dir /path/to/site          # 자동: vercel 우선, 없으면 netlify

환경변수 (둘 중 하나 필요):
  VERCEL_TOKEN     — Vercel personal access token (vercel.com/account/tokens)
  NETLIFY_AUTH_TOKEN — Netlify personal access token (app.netlify.com/user/applications)

성공 시 stdout 마지막 줄에 공개 URL 출력 (orders.json liveUrl 에 저장됨).
"""
import os, sys, subprocess, shutil, json, re

def _run(cmd, cwd=None, timeout=300):
    """명령 실행 → (ok, stdout). 에러 메시지도 stdout 에 포함."""
    try:
        r = subprocess.run(cmd, cwd=cwd, shell=True, capture_output=True, text=True, timeout=timeout)
        out = (r.stdout or '') + (r.stderr or '')
        return r.returncode == 0, out.strip()
    except subprocess.TimeoutExpired:
        return False, '타임아웃 (300초 초과)'
    except FileNotFoundError:
        return False, f'명령/도구 없음: {cmd.split()[0]}'
    except Exception as e:
        return False, str(e)

def _extract_url(text):
    """배포 출력에서 공개 URL 추출 (https://...vercel.app 또는 .netlify.app)."""
    m = re.findall(r'https://[^\s"\'<>]+\.(?:vercel\.app|netlify\.app)', text or '')
    return m[-1] if m else ''

def deploy_vercel(site_dir):
    token = os.environ.get('VERCEL_TOKEN', '').strip()
    if not token:
        print('⚠️ VERCEL_TOKEN 환경변수가 없습니다 — Vercel 배포 불가.')
        print('   발급: https://vercel.com/account/tokens → "Add Token" → export VERCEL_TOKEN=xxx')
        print('   배포 없이 로컬 미리보기로 대체: cd "' + site_dir + '" && npx serve')
        return False, ''
    if not shutil.which('npx'):
        print('⚠️ npx(node)를 찾을 수 없습니다 — Node.js 설치 필요.')
        return False, ''
    print(f'· Vercel 배포 중: {site_dir}')
    ok, out = _run(f'npx --yes vercel deploy --prod --yes --token={token}', cwd=site_dir)
    print(out)
    url = _extract_url(out)
    if ok and url:
        print(f'✅ 배포 성공: {url}')
        return True, url
    if ok and not url:
        print('✅ 배포 완료 (URL 추출 실패 — vercel 대시보드에서 확인)')
        return True, ''
    print('❌ Vercel 배포 실패 — 위 로그를 확인하세요.')
    return False, ''

def deploy_netlify(site_dir):
    token = os.environ.get('NETLIFY_AUTH_TOKEN', '').strip()
    if not token:
        print('⚠️ NETLIFY_AUTH_TOKEN 환경변수가 없습니다 — Netlify 배포 불가.')
        print('   발급: https://app.netlify.com/user/applications → "New access token" → export NETLIFY_AUTH_TOKEN=xxx')
        print('   배포 없이 로컬 미리보기로 대체: cd "' + site_dir + '" && npx serve')
        return False, ''
    if not shutil.which('npx'):
        print('⚠️ npx(node)를 찾을 수 없습니다 — Node.js 설치 필요.')
        return False, ''
    print(f'· Netlify 배포 중: {site_dir}')
    ok, out = _run(f'NETLIFY_AUTH_TOKEN={token} npx --yes netlify-cli deploy --prod --dir="{site_dir}"', cwd=site_dir)
    print(out)
    url = _extract_url(out)
    if ok and url:
        print(f'✅ 배포 성공: {url}')
        return True, url
    if ok and not url:
        print('✅ 배포 완료 (URL 추출 실패 — netlify 대시보드에서 확인)')
        return True, ''
    print('❌ Netlify 배포 실패 — 위 로그를 확인하세요.')
    return False, ''

def main():
    args = sys.argv[1:]
    provider = 'auto'
    site_dir = ''
    i = 0
    while i < len(args):
        a = args[i]
        if a in ('--provider',) and i + 1 < len(args): provider = args[i+1]; i += 2
        elif a.startswith('--provider='): provider = a.split('=',1)[1]; i += 1
        elif a in ('--dir', '--directory', '--site') and i + 1 < len(args): site_dir = args[i+1]; i += 2
        elif a.startswith('--dir='): site_dir = a.split('=',1)[1]; i += 1
        elif a in ('-h','--help'):
            print(__doc__); return 0
        else: i += 1
    site_dir = os.path.expanduser(site_dir or '.')
    if not os.path.isdir(site_dir):
        print(f'❌ 사이트 폴더를 찾을 수 없음: {site_dir}')
        return 1
    # index.html 없으면 경고 (계속 진행 — 빌드 산출물이 하위 폴더일 수 있음)
    if not os.path.exists(os.path.join(site_dir, 'index.html')):
        print(f'⚠️ {site_dir}/index.html 이 없습니다 — 배포가 빈 페이지가 될 수 있음.')

    if provider == 'vercel':
        ok, url = deploy_vercel(site_dir)
    elif provider == 'netlify':
        ok, url = deploy_netlify(site_dir)
    else:  # auto: 토큰 있는 쪽 우선
        if os.environ.get('VERCEL_TOKEN', '').strip():
            ok, url = deploy_vercel(site_dir)
        elif os.environ.get('NETLIFY_AUTH_TOKEN', '').strip():
            ok, url = deploy_netlify(site_dir)
        else:
            print('⚠️ 배포 토큰이 없습니다 (VERCEL_TOKEN 또는 NETLIFY_AUTH_TOKEN).')
            print('   발급 후 환경변수 세팅 → 재배포. 또는 로컬 미리보기: cd "' + site_dir + '" && npx serve')
            return 0
    # URL 이 있으면 마지막 줄에만 출력 (orders.json liveUrl 저장용)
    if url:
        sys.stdout.write('\n' + url)
    return 0 if ok else 1

if __name__ == '__main__':
    sys.exit(main())
