# Generation API Contract

`POST /api/generate` receives course materials, generation settings, and safety metadata from the frontend.

The backend must return final user-facing content only. Do not return prompts, hidden instructions, chain-of-thought, or model planning text.

Example response:

```json
{
  "output": {
    "title": "Focused Quiz",
    "type": "quiz",
    "checks": [
      {
        "label": "Solvability",
        "status": "pass",
        "detail": "Each question has enough information to answer."
      }
    ],
    "safety": {
      "level": "clear",
      "label": "Neutral Review",
      "reason": "No blocking issue detected."
    },
    "items": [
      {
        "title": "Q1",
        "body": "Final student-facing question text.",
        "answer": "Final answer or marking guide.",
        "points": 20,
        "options": [],
        "choiceType": "none",
        "meta": ["Standard", "Short Answer"],
        "checks": []
      }
    ]
  }
}
```

If the backend cannot generate safely or correctly, return a refusal-style `output` object instead of a prompt.

## Exam Grading

`POST /api/grade` receives generated questions, reference answers, per-question maximum points, and student responses. Blank responses are scored as zero without an AI request.

Example response:

```json
{
  "results": [
    {
      "index": 0,
      "score": 18,
      "feedback": "The method is correct; the final arithmetic step needs correction."
    }
  ],
  "summary": "Strong understanding with a minor calculation error."
}
```

Each score must remain between zero and the corresponding question's maximum points.
