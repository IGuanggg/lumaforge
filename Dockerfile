FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    APP_RUNTIME_DIR=/app/userdata \
    APP_VERSION=2.0.14 \
    APP_PORT=3000

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py launcher.py ./
COPY static ./static
COPY workflows ./workflows

RUN mkdir -p /app/userdata

COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["python", "main.py"]
