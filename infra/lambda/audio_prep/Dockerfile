FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NUMBA_CACHE_DIR=/tmp/numba-cache

RUN apt-get update \
    && apt-get install --no-install-recommends -y ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /var/task
COPY infra/lambda/audio_prep/requirements.txt /tmp/audio-requirements.txt
RUN python -m pip install --no-cache-dir -r /tmp/audio-requirements.txt

COPY src ./src
COPY infra/lambda/audio_prep/index.py ./index.py

ENTRYPOINT ["python", "-m", "awslambdaric"]
CMD ["index.handler"]
