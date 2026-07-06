import { Request, Response } from "express";
import fs from "fs";
import { openai } from "../../config/openai"
import prisma from "../../service/prisma-client";
import { generateTemplatedOpdDraft, OpdFieldDef } from "../../service/opd-assessment-ai";

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

        // Phase 9.21 — when a doctor template is supplied, structure the
        // transcript DYNAMICALLY into that template's field keys instead of
        // the fixed history/examination/investigation/treatmentPlan sections.
        const noteTemplateId = (req.body?.noteTemplateId as string | undefined)?.trim();
        if (noteTemplateId) {
            const template = await prisma.noteTemplate.findUnique({ where: { id: noteTemplateId } });
            if (template) {
                let fields: OpdFieldDef[] = [];
                try { fields = JSON.parse(template.fields); } catch { fields = []; }
                const draft = await generateTemplatedOpdDraft(rawText, { name: template.name, fields });
                fs.unlinkSync(audioPath);
                res.json({ transcript: rawText, templatedValueMap: draft.templatedValueMap });
                return;
            }
        }

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

        FORMATTING RULES: 
        1. Investigation → each test on a new line.
        2. Treatment Plan → each medication or instruction on a new line.
        3. Do NOT return treatment plan as a paragraph.

          Example treatmentPlan:
Dolo 650 mg – Three times a day for 5 days
Citrazin – Twice a day (morning and night) for 5 days
Monta-LC – Once at night for 5 days

Example investigation:
CBC
ESR
X-ray right knee
        `,

                },
                {
                    role: "user",
                    content: rawText,
                },
            ],
            response_format: { type: "json_object" },
        });
        //         const structured = await openai.chat.completions.create({
        //             model: "gpt-4o-mini",
        //             messages: [
        //                 {
        //                     role: "system",
        //                     content: `
        // You are a medical assistant.

        // Split the doctor's dictation into these four sections:

        // history
        // examination
        // investigation
        // treatmentPlan

        // IMPORTANT RULES:
        // - Each field must contain plain text only.
        // - Do NOT return objects.
        // - Do NOT nest anything.
        // - Do NOT add extra fields.
        // - Return only this JSON structure:

        // {
        //   "history": "text",
        //   "examination": "text",
        //   "investigation": "text",
        //   "treatmentPlan": "text"
        // }


        // Example treatmentPlan:
        // Dolo 650 mg – Three times a day for 5 days
        // Citrazin – Twice a day (morning and night) for 5 days
        // Monta-LC – Once at night for 5 days

        // Example investigation:
        // CBC
        // ESR
        // X-ray right knee

        // Return JSON only.
        //       `,
        //                 },
        //                 {
        //                     role: "user",
        //                     content: rawText,
        //                 },
        //             ],
        //             response_format: { type: "json_object" },
        //         });


        console.log(structured.choices[0].message.content, 'structured text')

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
