import json
import os
import time

import boto3


s3 = boto3.client("s3")
transcribe = boto3.client("transcribe")
bedrock = boto3.client("bedrock-runtime")
table = boto3.resource("dynamodb").Table(os.environ["RECORDINGS_TABLE"])
bucket = os.environ["DATA_BUCKET"]


def update(event, status, **fields):
    names = {"#s": "status"}
    values = {":s": status}
    parts = ["#s=:s"]
    fields["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for index, (key, value) in enumerate(fields.items()):
        names[f"#k{index}"] = key
        values[f":v{index}"] = value
        parts.append(f"#k{index}=:v{index}")
    table.update_item(
        Key={"user_id": event["user_id"], "recording_id": event["recording_id"]},
        UpdateExpression="SET " + ", ".join(parts),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )


def handler(event, context):
    action = event["action"]

    if action == "start":
        extension = event["audio_s3_key"].rsplit(".", 1)[-1].lower()
        media_format = {"wav": "wav", "mp3": "mp3", "m4a": "m4a"}[extension]
        job = (
            f"{os.environ['ENVIRONMENT']}-{event['recording_id']}-{int(time.time())}"
        )
        base = event["audio_s3_key"].rsplit("/", 1)[0]
        transcript_key = base + "/transcript.json"
        transcribe.start_transcription_job(
            TranscriptionJobName=job,
            Media={"MediaFileUri": f"s3://{bucket}/{event['audio_s3_key']}"},
            MediaFormat=media_format,
            LanguageCode="en-US",
            OutputBucketName=bucket,
            OutputKey=transcript_key,
        )
        update(
            event,
            "TRANSCRIBING",
            transcription_job_name=job,
            transcript_s3_key=transcript_key,
        )
        return {
            **event,
            "transcription_job_name": job,
            "transcript_s3_key": transcript_key,
        }

    if action == "status":
        job = transcribe.get_transcription_job(
            TranscriptionJobName=event["transcription_job_name"]
        )["TranscriptionJob"]
        return {
            **event,
            "transcribe_status": job["TranscriptionJobStatus"],
            "failure_reason": job.get("FailureReason", ""),
            "error": job.get("FailureReason", "Transcription job failed"),
        }

    if action == "analyze":
        raw = s3.get_object(Bucket=bucket, Key=event["transcript_s3_key"])[
            "Body"
        ].read()
        document = json.loads(raw)
        transcripts = document.get("results", {}).get("transcripts") or [
            {"transcript": ""}
        ]
        text = transcripts[0]["transcript"]
        items = document.get("results", {}).get("items", [])
        words = [item for item in items if item.get("type") == "pronunciation"]
        duration = max([float(item.get("end_time", 0)) for item in words] or [0.0])
        tokens = [
            item.get("alternatives", [{}])[0].get("content", "").lower()
            for item in words
        ]
        fillers = {
            word: tokens.count(word)
            for word in ["um", "uh", "like", "actually", "basically"]
            if tokens.count(word)
        }
        metrics = {
            "word_count": len(words),
            "duration_seconds": round(duration, 2),
            "words_per_minute": (
                round(len(words) / (duration / 60), 1) if duration else 0
            ),
            "filler_words": fillers,
        }
        analysis_key = event["transcript_s3_key"].replace(
            "transcript.json", "audio_analysis.json"
        )
        s3.put_object(
            Bucket=bucket,
            Key=analysis_key,
            Body=json.dumps(metrics).encode(),
            ContentType="application/json",
        )
        update(
            event,
            "ANALYZED",
            summary_metrics=metrics,
            analysis_s3_key=analysis_key,
        )
        return {
            **event,
            "transcript_text": text[:12000],
            "summary_metrics": metrics,
            "analysis_s3_key": analysis_key,
        }

    if action == "feedback":
        prompt = json.dumps(
            {
                "metrics": event["summary_metrics"],
                "transcript": event.get("transcript_text", ""),
            }
        )
        result = bedrock.converse(
            modelId=os.environ["BEDROCK_MODEL_ID"],
            system=[
                {
                    "text": (
                        "You are a public-speaking coach. Base feedback only on the "
                        "supplied metrics and transcript. Return concise strengths, "
                        "priorities, and three concrete exercises."
                    )
                }
            ],
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 800, "temperature": 0.2},
        )
        feedback = "".join(
            block.get("text", "")
            for block in result["output"]["message"]["content"]
        )
        update(event, "COMPLETE", ai_feedback=feedback)
        clean = dict(event)
        clean.pop("transcript_text", None)
        return {**clean, "status": "COMPLETE"}

    if action == "fail":
        update(
            event,
            "FAILED",
            failure_reason=str(event.get("error", "Workflow failed"))[:1000],
        )
        return {**event, "status": "FAILED"}

    raise ValueError(f"Unsupported action: {action}")
