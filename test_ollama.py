import requests
import json

try:
    res = requests.post('http://127.0.0.1:11434/api/generate', json={"model": "gemma4:e2b", "prompt": "1+1은?", "stream": False})
    print(res.status_code)
    print(res.text)
except Exception as e:
    print(e)
