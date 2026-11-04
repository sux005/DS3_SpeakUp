FROM python:3.11-slim

ARG DEEPFILTERNET_MODEL_URL=https://raw.githubusercontent.com/Rikorose/DeepFilterNet/v0.5.6/models/DeepFilterNet3.zip
ARG DEEPFILTERNET_MODEL_SHA256=49c52edc8947ae1f9bf50d81530beaf3a2c3245aeaf34b6f31ff535cd22284d2

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    NUMBA_CACHE_DIR=/tmp/numba-cache \
    XDG_CACHE_HOME=/opt/model-cache \
    AUDIO_ENHANCEMENT_BACKEND=deepfilternet \
    AUDIO_ENHANCEMENT_MODEL=DeepFilterNet3

WORKDIR /var/task
COPY infra/lambda/audio_prep/requirements.txt /tmp/audio-requirements.txt
RUN python -m pip install -r /tmp/audio-requirements.txt && \
    python -m pip uninstall -y wheel
RUN python -c "import hashlib, io, pathlib, sys, urllib.request, zipfile; url, expected, destination = sys.argv[1:]; payload = urllib.request.urlopen(url).read(); actual = hashlib.sha256(payload).hexdigest(); assert actual == expected, f'model checksum mismatch: {actual}'; pathlib.Path(destination).mkdir(parents=True, exist_ok=True); zipfile.ZipFile(io.BytesIO(payload)).extractall(destination)" \
        "$DEEPFILTERNET_MODEL_URL" "$DEEPFILTERNET_MODEL_SHA256" "/opt/model-cache/DeepFilterNet" && \
    python -c "import os; from df.enhance import init_df; init_df(model_base_dir=os.environ['AUDIO_ENHANCEMENT_MODEL'], log_level='NONE', log_file=None)"

COPY src ./src
COPY infra/lambda/audio_prep/index.py ./index.py

ENTRYPOINT ["python", "-m", "awslambdaric"]
CMD ["index.handler"]
