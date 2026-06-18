/* llm.ts — 경량 LLM 호출 헬퍼 (Ollama/LM Studio 공용, 짧은 분류·증류용).
 * extension.ts 모놀리스에서 분리 (refactor/split-extension, 동작 보존 이동).
 * 의존: axios + config(getConfig·엔진감지). 본문 역참조 없음 — telegram 분류·스킬 증류 등이 공유. */
import axios from 'axios';
import { getConfig, _isLMStudioEngine } from './config';

export async function _quickLLMCall(systemPrompt: string, userMsg: string, maxTokens = 64): Promise<string> {
    const { ollamaBase, defaultModel, timeout } = getConfig();
    const isLMStudio = _isLMStudioEngine(ollamaBase);
    const apiUrl = isLMStudio ? `${ollamaBase}/v1/chat/completions` : `${ollamaBase}/api/chat`;
    const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg }
    ];
    const tmo = Math.min(timeout || 60000, 60000);
    if (isLMStudio) {
        const body = { model: defaultModel, messages, stream: false, max_tokens: maxTokens, temperature: 0.2 };
        const r = await axios.post(apiUrl, body, { timeout: tmo });
        return r.data?.choices?.[0]?.message?.content?.toString().trim() || '';
    }
    const body = { model: defaultModel, messages, stream: false, options: { num_predict: maxTokens, temperature: 0.2 } };
    const r = await axios.post(apiUrl, body, { timeout: tmo });
    return r.data?.message?.content?.toString().trim() || '';
}
