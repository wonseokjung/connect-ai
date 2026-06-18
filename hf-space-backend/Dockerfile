FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 7860
# HF Spaces는 7860 포트로 서비스 노출
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
