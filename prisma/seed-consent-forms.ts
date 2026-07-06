/**
 * Phase 2 — Seed initial consent forms (English).
 *
 * Run with:
 *   npx ts-node prisma/seed-consent-forms.ts
 *
 * Idempotent: uses upsert on (consentType, version, language). Re-running
 * updates the body text in place if you change wording during development.
 *
 * Hindi / Kannada translations land in next session — seed structure is
 * the same, just additional rows with `language = 'hi' | 'kn'`.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SeedForm {
  consentType: string;
  title: string;
  bodyText: string;
  requiresWitness?: boolean;
}

const forms: SeedForm[] = [
  {
    consentType: 'admission',
    title: 'General Admission Consent',
    bodyText: `
I voluntarily consent to admission to this hospital and to general medical care, including routine diagnostic tests, examinations, nursing care, and standard treatments deemed necessary by the treating doctors. I understand that:

1. The treating team will explain my condition and proposed care plan to me in a language I understand.
2. I have the right to ask questions, seek a second opinion, and refuse any specific procedure or treatment.
3. My medical records will be kept confidential and used only for clinical care, billing, statutory reporting, and (with my separate consent) research or education.
4. Photographs may be taken of my condition for clinical record purposes; any other use requires separate written consent.
5. I will pay all charges for services rendered as per the hospital's published tariff.

I confirm that the information I have provided about my health, medications, and allergies is accurate to the best of my knowledge.
`.trim(),
  },
  {
    consentType: 'treatment',
    title: 'Informed Consent for Treatment / Procedure',
    bodyText: `
The treating doctor has explained my diagnosis and the proposed treatment / procedure to me. I understand:

1. The nature and purpose of the treatment / procedure.
2. The expected benefits and the likelihood of success.
3. The known risks, complications, and possible side effects.
4. The alternative treatments available and their risks and benefits.
5. The likely outcome if I refuse the treatment.
6. The name of the doctor / team who will perform the procedure.

I have had the opportunity to ask questions and have received satisfactory answers. I voluntarily consent to undergo the treatment / procedure described to me.

I understand that during the procedure, the doctor may discover unforeseen conditions requiring additional procedures. I authorise such additional procedures only if they are necessary to safeguard my life and well-being.
`.trim(),
    requiresWitness: false,
  },
  {
    consentType: 'anaesthesia',
    title: 'Consent for Administration of Anaesthesia',
    bodyText: `
The anaesthesiologist has explained the type of anaesthesia (general / regional / spinal / local / sedation) planned for my procedure and has reviewed my medical history, allergies, and current medications.

I understand:
1. The type of anaesthesia planned and why it is appropriate for my procedure.
2. The common risks: nausea, sore throat, drowsiness, headache, temporary memory effects.
3. The rare but serious risks: drug reaction, breathing difficulty, nerve injury, awareness during anaesthesia, cardiac complications, and (very rarely) death.
4. That the anaesthesia plan may be modified during the procedure if my safety requires it.
5. That a different anaesthesiologist may administer anaesthesia if the originally planned one is unavailable.

I voluntarily consent to the administration of anaesthesia as planned.
`.trim(),
  },
  {
    consentType: 'blood',
    title: 'Consent for Blood / Blood Component Transfusion',
    bodyText: `
The treating doctor has explained that I may need transfusion of blood or blood components (red cells, platelets, plasma, cryoprecipitate) before, during, or after my treatment.

I understand:
1. The purpose of the transfusion and the likely benefit.
2. The common reactions: fever, chills, mild allergic reaction.
3. The rare but serious risks: severe allergic reaction, transfusion-related lung injury, transmission of infection (despite screening), incompatibility reaction, and (very rarely) death.
4. The available alternatives, including not receiving transfusion and accepting the consequences.
5. That blood used will be screened as per national standards (HIV, hepatitis B, hepatitis C, syphilis, malaria).

I voluntarily consent to receive blood / blood components if the treating doctor determines it necessary for my care.
`.trim(),
  },
  {
    consentType: 'financial',
    title: 'Financial Consent and Acceptance of Estimate',
    bodyText: `
I have been informed of the estimated cost of treatment / procedure as per the hospital tariff. I understand:

1. The estimate provided is approximate and the final bill may vary based on the actual services rendered, length of stay, complications, and additional procedures.
2. I am responsible for the full payment of all charges, whether or not my insurance / scheme reimburses them.
3. Any insurance approval or scheme coverage will be processed in parallel; I remain liable for non-covered amounts.
4. Advance payment may be required at admission and at intervals during stay; failure to pay may result in step-down of services to the basic level until payment is regularised.
5. Discharge will be released only after settlement of dues unless otherwise agreed in writing.

I accept the financial terms and consent to proceed with the treatment.
`.trim(),
  },
  {
    consentType: 'photography',
    title: 'Consent for Clinical Photography / Audio-Video Recording',
    bodyText: `
I consent to the taking of photographs, audio recordings, or video recordings of my condition, treatment, or procedure for the following purposes:

1. Inclusion in my medical record for clinical reference.
2. Internal hospital quality reviews and case discussions among the treating team.
3. Anonymous use in medical education, training, and research (with all identifying features removed).

I understand:
- My identity will not be revealed in any external use.
- I may withdraw this consent at any time; recordings already made will be retained as part of my medical record but no further external use will be made.
- I may decline any specific recording without affecting my care.
`.trim(),
  },
  {
    consentType: 'high-risk',
    title: 'High-Risk Procedure Consent',
    bodyText: `
The treating doctor has explained that my proposed procedure / surgery is classified as high risk because of one or more of: my underlying medical condition, the complexity of the procedure, the high probability of complications, or the requirement for intensive post-procedure care.

In addition to the standard treatment consent, I specifically acknowledge:

1. The procedure carries a significantly higher risk of serious complications, including major bleeding, organ injury, infection, prolonged ICU stay, permanent disability, or death.
2. Despite all reasonable precautions, the outcome cannot be guaranteed.
3. I may require admission to the ICU, mechanical ventilation, dialysis, or further surgery.
4. The estimated cost may be substantially higher than for routine procedures.
5. A witness has been present during the explanation and signs below.

I voluntarily consent to the high-risk procedure with full understanding of the above.
`.trim(),
    requiresWitness: true,
  },
];

async function main(): Promise<void> {
  const VERSION = '1.0';
  const LANGUAGE = 'en';

  for (const form of forms) {
    const result = await prisma.consentForm.upsert({
      where: {
        consentType_version_language: {
          consentType: form.consentType,
          version: VERSION,
          language: LANGUAGE,
        },
      },
      update: {
        title: form.title,
        bodyText: form.bodyText,
        requiresWitness: form.requiresWitness ?? false,
        isActive: true,
      },
      create: {
        consentType: form.consentType,
        version: VERSION,
        language: LANGUAGE,
        title: form.title,
        bodyText: form.bodyText,
        requiresWitness: form.requiresWitness ?? false,
        isActive: true,
        createdBy: 'system-seed',
      },
    });
    console.log(`✓ ${result.consentType} v${result.version} (${result.language}) — id=${result.id}`);
  }

  console.log(`\nSeeded ${forms.length} consent forms.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error('Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
