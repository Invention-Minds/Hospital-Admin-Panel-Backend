import { Request, Response } from "express";
import fs from "fs";
import { openai } from "../../config/openai"

export const voiceAssessment = async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            res.status(400).json({ error: "No audio file uploaded" });
            return;
        }

        const audioPath = req.file.path;

        console.log(audioPath)

        // Step 1: Transcribe audio
        const transcript = await openai.audio.transcriptions.create({
            file: fs.createReadStream(audioPath),
            language: "en",
            model: "gpt-4o-mini-transcribe",
        });


        const rawText = transcript.text;

        console.log(rawText)

        // Step 2: Convert transcript into structured sections
        const structured = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: `
You are a medical assistant.

Split the doctor's dictation into these four sections:

history
examination
investigation
treatmentPlan

IMPORTANT RULES:
- Each field must contain plain text only.
- Do NOT return objects.
- Do NOT nest anything.
- Do NOT add extra fields.
- Return only this JSON structure:

{
  "history": "text",
  "examination": "text",
  "investigation": "text",
  "treatmentPlan": "text"
}
`,

                },
                {
                    role: "user",
                    content: rawText,
                },
            ],
            response_format: { type: "json_object" },
        });

        // console.log(structured, 'structured text')

        const parsed = JSON.parse(structured.choices[0].message.content || "{}");

        // Delete audio file after processing
        fs.unlinkSync(audioPath);

        res.json({
            transcript: rawText,
            ...parsed,
        });
    } catch (error) {
        console.error("Voice processing error:", error);
        res.status(500).json({ error: "Voice processing failed" });
    }
};
