# Bedrock prompt: old (team) vs new, Links 13-16

Proposal, not on `main`. This compares the prompt that was on `main` on 11/09 with a new structured prompt. Bedrock feedback is currently off on `main`, and Jay is also working on the feedback format, so treat this as input for that work.

Model us.amazon.nova-lite-v1:0, temperature 0.2, 2 runs per prompt per clip. Input = team rubric metrics + Transcribe text.

## Scorecard

| Check | Old prompt (8 runs) | New prompt (8 runs) |
|---|---|---|
| valid JSON | 0/8 | 8/8 |
| no between-sentence pause advice | 6/8 | 8/8 |
| no off-topic text | 6/8 | 8/8 |
| all 3 scores correct | 0/8 | 8/8 |
| worst metric is priority 1 | 5/8 | 8/8 |
| no 4-score metric as priority | n/a (free text) | 8/8 |
| 3 exercises | n/a (free text) | 8/8 |
| exercises target focus | n/a (free text) | 8/8 |
| every target measurable | n/a (free text) | 6/8 |

## Link 13: thesis defense opening (hesitant)

150 WPM (score 4), 9.7 fillers/100 words (score 0), 18.4 inside pauses/speaking min (score 0), 1 long pauses

### old prompt, run 1

### Strengths
1. **Clear Structure**: Your speech has a clear and organized structure, starting with acknowledgments and then moving on to thanking specific individuals.
2. **Engagement**: You engage with your audience by addressing them directly and expressing gratitude, which helps in maintaining their interest.
3. **Pacing**: Your speaking rate is well-paced, making it easy for the audience to follow along.

### Priorities
1. **Reduce Filler Words**: You use a significant number of filler words ("um," "uh," "you know"), which can distract from your message. Aim to minimize these to improve clarity.
2. **Manage Pauses**: While pauses can be useful, the number and length of pauses inside sentences can disrupt the flow. Work on reducing these to maintain a smoother delivery.
3. **Conciseness**: Ensure that your acknowledgments are concise and to the point to keep the audience engaged.

### Exercises
1. **Filler Word Reduction**: Practice reading your speech aloud and consciously avoid using filler words. Record yourself and review the playback to identify areas for improvement.
2. **Pause Management**: Work on reducing pauses inside sentences by practicing your speech with a timer. Aim to keep your speaking flow continuous.
3. **Conciseness Drill**: Write a shorter version of your acknowledgments, focusing on the most important points. Practice delivering this concise version to ensure it still conveys your message effectively.

### new prompt, run 1

```json
{
  "summary": "Your speech was clear and well-paced, but it was hindered by frequent filler words and pauses within sentences.",
  "scores": [
    {
      "metric": "speaking_rate",
      "score": 4,
      "level": "Advanced",
      "measurement": "150 WPM",
      "comment": "Your speaking rate was excellent, at 150 WPM."
    },
    {
      "metric": "filler_words",
      "score": 0,
      "level": "Deficient",
      "measurement": "9.7 fillers per 100 words (29 fillers)",
      "comment": "You used too many filler words, which detracted from your message."
    },
    {
      "metric": "pauses_inside_sentences",
      "score": 0,
      "level": "Deficient",
      "measurement": "18.4 pauses inside sentences per speaking minute (29 pauses)",
      "comment": "You had too many pauses within sentences, which made your speech less fluid."
    }
  ],
  "strengths": [
    {
      "text": "Your speech was clear and well-paced overall.",
      "evidence": "Your speaking rate was excellent, at 150 WPM."
    }
  ],
  "priorities": [
    {
      "metric": "filler_words",
      "text": "Reduce the number of filler words in your speech.",
      "evidence": "You used too many filler words, which detracted from your message."
    },
    {
      "metric": "pauses_inside_sentences",
      "text": "Minimize pauses within sentences to improve fluency.",
      "evidence": "You had too many pauses within sentences, which made your speech less fluid."
    }
  ],
  "exercise_1": {
    "metric": "filler_words",
    "title": "Filler Word Reduction",
    "steps": "Read a paragraph aloud, aiming to use no more than 2 fillers per 100 words. Record yourself and count the fillers.",
    "target": "2 fillers per 100 words"
  },
  "exercise_2": {
    "metric": "pauses_inside_sentences",
    "title": "Pause Management",
    "steps": "Practice reading a paragraph aloud, focusing on reducing pauses within sentences. Aim for under 9 pauses per speaking minute.",
    "target": "under 9 pauses per speaking minute"
  },
  "exercise_3": {
    "metric": "filler_words",
    "title": "Mindful Speaking",
    "steps": "Engage in a conversation with a friend, consciously avoiding filler words. After the conversation, count the number of fillers used.",
    "target": "under 3 fillers per 100 words"
  }
}
```

## Link 14: thesis defense (fluent)

143 WPM (score 4), 7.0 fillers/100 words (score 1), 4.9 inside pauses/speaking min (score 4), 0 long pauses

### old prompt, run 1

### Strengths:
1. **Engaging Content**: Your speech is rich in details about Guillen's contributions and character, which helps in creating a vivid picture for the audience.
2. **Clear Speaking Rate**: Your words per minute (143.38) are well-paced, ensuring the audience can follow along comfortably.
3. **Personal Touch**: Sharing personal anecdotes and experiences adds authenticity and relatability to your speech.

### Priorities:
1. **Reduce Filler Words**: The use of filler words like "uh" and "um" can detract from the professionalism of your speech. Aim to minimize these to improve clarity and impact.
2. **Manage Pauses**: While pauses can be useful for emphasis, the frequency and length of pauses should be controlled to maintain a smooth flow.
3. **Conciseness**: Ensure that every word serves a purpose. Removing redundant phrases can help in delivering a more powerful message.

### Exercises:
1. **Filler Word Reduction**: Practice reading your speech aloud and record yourself. Focus on identifying and eliminating filler words. Aim for a filler word count less than 10.
2. **Controlled Pauses**: Write down your speech with intentional pauses marked. Practice delivering it, ensuring that pauses are used effectively to emphasize key points rather than out of habit.
3. **Conciseness Drill**: Edit your transcript to remove any redundant phrases or repetitive words. Aim to deliver the core message in fewer words without losing the essence. 

By focusing on these areas, you can enhance the overall effectiveness of your public speaking.

### new prompt, run 1

```json
{
  "summary": "Your speech was clear and well-paced, but the use of filler words could be reduced for a more polished delivery.",
  "scores": [
    {
      "metric": "speaking_rate",
      "score": 4,
      "level": "Advanced",
      "measurement": "143 WPM",
      "comment": "Your speaking rate was excellent, falling within the advanced range."
    },
    {
      "metric": "filler_words",
      "score": 1,
      "level": "Minimal",
      "measurement": "7.0 fillers per 100 words (20 fillers)",
      "comment": "You used a high number of filler words, which detracted from the clarity of your speech."
    },
    {
      "metric": "pauses_inside_sentences",
      "score": 4,
      "level": "Advanced",
      "measurement": "4.9 pauses inside sentences per speaking minute (9 pauses)",
      "comment": "You had very few pauses inside sentences, which helped maintain a smooth flow."
    }
  ],
  "strengths": [
    {
      "text": "Your speech was clear and well-paced.",
      "evidence": "Your speaking rate was excellent, falling within the advanced range."
    }
  ],
  "priorities": [
    {
      "metric": "filler_words",
      "text": "Reduce the number of filler words to improve clarity.",
      "evidence": "You used a high number of filler words, which detracted from the clarity of your speech."
    }
  ],
  "exercise_1": {
    "metric": "filler_words",
    "title": "Filler Word Awareness",
    "steps": "Read a short paragraph from a book or article. Count the number of filler words you use and aim to reduce this number by half.",
    "target": "Reduce filler words by 50%"
  },
  "exercise_2": {
    "metric": "filler_words",
    "title": "Mindful Speaking",
    "steps": "Practice speaking on a topic for 5 minutes without using any filler words. Record yourself and listen back to check.",
    "target": "Speak for 5 minutes without any filler words"
  },
  "exercise_3": {
    "metric": "filler_words",
    "title": "Filler Word Substitution",
    "steps": "Choose 3 filler words you often use and find alternative words or phrases to replace them. Practice using these alternatives in your speech.",
    "target": "Use alternative words for 3 filler words in a 3-minute speech"
  }
}
```

## Link 15: TED talk

168 WPM (score 3), 0.9 fillers/100 words (score 4), 5.4 inside pauses/speaking min (score 4), 2 long pauses

### old prompt, run 1

### Strengths:
1. **Engaging Opening**: The speaker starts with a strong, attention-grabbing statement that dismisses common advice, which can capture the audience's interest immediately.
2. **Clear Structure**: The speech is well-structured with a clear introduction and a list of rules, making it easy for the audience to follow.
3. **High Speaking Duration**: The speaker maintains a high speaking duration of 100.79 seconds out of 119.8 seconds, ensuring a high level of engagement.

### Priorities:
1. **Reduce Filler Words**: The use of filler words like "uh" and "um" should be minimized to improve clarity and professionalism.
2. **Manage Pauses**: The number of pauses, especially long pauses, should be reduced to maintain a smoother flow of speech.
3. **Engagement**: Ensure that the audience remains engaged throughout by avoiding long pauses and filler words.

### Exercises:
1. **Filler Word Reduction**: Practice delivering the speech multiple times while consciously avoiding filler words. Record and review each practice session to track improvement.
2. **Pause Management**: Work on reducing the number of pauses, especially long pauses, by practicing with a timer to maintain a steady speaking pace.
3. **Engagement Drills**: Engage in conversations with peers or in front of a mirror, focusing on maintaining full presence and avoiding distractions to simulate the "don't multitask" rule. Record these interactions to review and improve.

### new prompt, run 1

```json
{
  "summary": "Your speech was engaging and delivered at a fast pace, but you could benefit from slowing down a bit to improve clarity.",
  "scores": [
    {
      "metric": "speaking_rate",
      "score": 3,
      "level": "Proficient",
      "measurement": "168 WPM (too fast)",
      "comment": "Your speaking rate was slightly too fast, which may have made it harder for some listeners to follow."
    },
    {
      "metric": "filler_words",
      "score": 4,
      "level": "Advanced",
      "measurement": "0.9 fillers per 100 words (3 fillers)",
      "comment": "Your use of filler words was excellent, keeping them to a minimum."
    },
    {
      "metric": "pauses_inside_sentences",
      "score": 4,
      "level": "Advanced",
      "measurement": "5.4 pauses inside sentences per speaking minute (9 pauses)",
      "comment": "Your pauses inside sentences were well-placed and helped maintain the flow of your speech."
    }
  ],
  "strengths": [
    {
      "text": "You used pauses effectively between sentences, which helped to emphasize key points.",
      "evidence": "12 pauses between sentences"
    }
  ],
  "priorities": [
    {
      "metric": "speaking_rate",
      "text": "Focus on reducing your speaking rate to improve clarity and engagement.",
      "evidence": "168 WPM (too fast)"
    }
  ],
  "exercise_1": {
    "metric": "speaking_rate",
    "title": "Slow Down",
    "steps": "Choose a passage from your speech and practice reading it at 150 WPM. Focus on articulating each word clearly.",
    "target": "150 WPM"
  },
  "exercise_2": {
    "metric": "speaking_rate",
    "title": "Mindful Speaking",
    "steps": "Practice speaking on a topic of your choice at a comfortable pace. Pay attention to how your body feels and adjust your speed accordingly.",
    "target": "N/A"
  },
  "exercise_3": {
    "metric": "speaking_rate",
    "title": "Pacing Practice",
    "steps": "Record yourself speaking on a familiar topic. Play it back and note where you tend to speed up. Focus on maintaining a steady pace during your next practice session.",
    "target": "N/A"
  }
}
```

## Link 16: student class speech

194 WPM (score 1), 0.0 fillers/100 words (score 4), 1.7 inside pauses/speaking min (score 4), 0 long pauses

### old prompt, run 1

### Strengths:
1. **Engaging Introduction**: You effectively capture the audience's attention right from the start by discussing the significant impact of coffee on people's lives.
2. **Clear Structure**: Your speech is well-organized, with a clear introduction of the three main points you plan to cover.
3. **Personal Connection**: Sharing your personal experience with coffee adds authenticity and relatability to your speech.

### Priorities:
1. **Smooth Transitions**: Work on making your transitions between points smoother to maintain the flow of your speech.
2. **Reduce Pauses**: Although your pauses are within acceptable limits, reducing them slightly could help maintain audience engagement.
3. **Expand on Points**: Provide more detailed explanations or examples for each of the three main points to deepen the audience's understanding.

### Exercises:
1. **Practice Transitions**: Write out your speech with a focus on creating smooth transitions between your main points. Practice delivering these transitions aloud.
2. **Record and Review**: Record yourself speaking and review the playback to identify and reduce unnecessary pauses.
3. **Expand Content**: For each main point, add at least one additional supporting detail or example. Practice incorporating these into your speech.

### Polite Response to Roast Queries:
While I appreciate your enthusiasm, it's important to maintain a respectful and supportive environment for everyone. Let's focus on constructive feedback and positive growth instead.

### new prompt, run 1

```json
{
  "summary": "Your speech was energetic and engaging, but you spoke too quickly, which made it hard to follow.",
  "scores": [
    {
      "metric": "speaking_rate",
      "score": 1,
      "level": "Minimal",
      "measurement": "194 WPM (too fast)",
      "comment": "Your speaking rate was too fast, making it difficult to follow."
    },
    {
      "metric": "filler_words",
      "score": 4,
      "level": "Advanced",
      "measurement": "0.0 fillers per 100 words (0 fillers)",
      "comment": "You used no filler words, which is excellent."
    },
    {
      "metric": "pauses_inside_sentences",
      "score": 4,
      "level": "Advanced",
      "measurement": "1.7 pauses inside sentences per speaking minute (3 pauses)",
      "comment": "You had very few pauses inside sentences, which is great."
    }
  ],
  "strengths": [
    {
      "text": "You used no filler words, which is excellent.",
      "evidence": "0.0 fillers per 100 words (0 fillers)"
    }
  ],
  "priorities": [
    {
      "metric": "speaking_rate",
      "text": "Your speaking rate was too fast, making it difficult to follow.",
      "evidence": "194 WPM (too fast)"
    }
  ],
  "exercise_1": {
    "metric": "speaking_rate",
    "title": "Slow Down",
    "steps": "Read the paragraph at 145 WPM. Focus on slowing down and articulating each word clearly.",
    "target": "145 WPM"
  },
  "exercise_2": {
    "metric": "speaking_rate",
    "title": "Pace Yourself",
    "steps": "Practice reading the transcript aloud, pausing at the end of each sentence. Gradually increase the length of the pauses until you can comfortably speak at 145 WPM.",
    "target": "145 WPM"
  },
  "exercise_3": {
    "metric": "speaking_rate",
    "title": "Controlled Breathing",
    "steps": "Practice deep breathing exercises to help control your speaking rate. Inhale deeply, then exhale slowly while counting to four. Repeat this process while speaking slowly and clearly.",
    "target": "145 WPM"
  }
}
```

