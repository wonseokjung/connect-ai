import requests
import json

try:
    res = requests.post('http://127.0.0.1:4825/api/evaluate', json={"prompt": "1+1은?"})
    print(res.status_code)
    print(res.text)
except Exception as e:
    print(e)
