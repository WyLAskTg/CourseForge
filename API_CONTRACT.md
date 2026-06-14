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
        "meta": ["Standard", "Short Answer"],
        "checks": []
      }
    ]
  }
}
```

If the backend cannot generate safely or correctly, return a refusal-style `output` object instead of a prompt.
