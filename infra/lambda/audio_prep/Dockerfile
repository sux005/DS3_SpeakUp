FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NUMBA_CACHE_DIR=/tmp/numba-cache

WORKDIR /var/task
COPY infra/lambda/audio_prep/requirements.txt /tmp/audio-requirements.txt
RUN --mount=type=cache,target=/root/.cache/pip \
    python -m pip install -r /tmp/audio-requirements.txt

COPY src ./src
COPY infra/lambda/audio_prep/index.py ./index.py

ENTRYPOINT ["python", "-m", "awslambdaric"]
CMD ["index.handler"]
