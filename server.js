import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { Resend } from "resend";

const app = express();
app.use(express.json());

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

function getField(fields, type) {
  const f = fields?.find((f) => f.type === type);
  if (!f) return null;
  if (type === "MULTIPLE_CHOICE") {
    const selected = f.options?.filter((o) => f.value?.includes(o.id));
    return selected?.map((o) => o.text).join(", ") || null;
  }
  return f.value || null;
}

function getFieldByLabel(fields, labelKeyword) {
  const f = fields?.find((f) =>
    f.label.toLowerCase().includes(labelKeyword.toLowerCase())
  );
  if (!f) return "not provided";
  if (f.type === "MULTIPLE_CHOICE") {
    const selected = f.options?.filter((o) => f.value?.includes(o.id));
    return selected?.map((o) => o.text).join(", ") || "not provided";
  }
  return f.value || "not provided";
}

async function generateReport(intake) {
  const response = await claude.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: `You are the Primal Span coach — a direct, no-nonsense longevity 
expert who cuts through wellness noise and tells people exactly what to fix 
and why. You don't flatter, you don't pad. You assess, prioritize, and give 
clear direction.

Your framework is the 4 Pillars of Primal Span:
1. SLEEP — the foundation. Nothing else works without it.
2. NUTRITION — fuel quality determines output quality.
3. MOVEMENT — the body is meant to move. Sedentary = accelerated aging.
4. STRESS — chronic stress is the silent killer of healthspan.

Your report style:
- Short punchy sentences. No waffle.
- Call out the biggest problem first, not the easiest win.
- Be honest if someone's habits are hurting them — say it plainly.
- Back every recommendation with a one-line reason why.
- Never use filler phrases like "great question" or "it's important to note".
- Write like a trusted expert who respects the reader's intelligence.`,

    messages: [{
      role: "user",
      content: `Write a Primal Span longevity assessment for this person:

Name: ${intake.name}, Age: ${intake.age}
Goals: ${intake.goals}
Sleep: ${intake.sleepHours} hours/night, quality ${intake.sleepQuality}/10
Energy pattern: ${intake.energyPattern}
Caffeine: ${intake.caffeine} cups/day
Stress: ${intake.stressLevel}/10
Exercise: ${intake.exerciseDays} days/week
Supplements: ${intake.supplements}
Notes: ${intake.notes}

Structure the report exactly like this:

PRIMAL SPAN SCORE: [X/100]
[2 sentences explaining the score based on their specific numbers. Be direct.]

YOUR BIGGEST PROBLEM RIGHT NOW
[Name the single most damaging habit or gap. No softening. One short paragraph.]

THE 4 PILLARS — YOUR BREAKDOWN

SLEEP
Status: [one word — Critical / Poor / Moderate / Good / Optimal]
[2-3 sentences on their sleep situation and exact impact on their healthspan.]
Fix this week: [one specific action, no vague advice]

NUTRITION
Status: [one word]
[2-3 sentences on their nutrition situation.]
Fix this week: [one specific action]

MOVEMENT
Status: [one word]
[2-3 sentences on their movement situation.]
Fix this week: [one specific action]

STRESS
Status: [one word]
[2-3 sentences on their stress situation.]
Fix this week: [one specific action]

BOTTOM LINE
[3 sentences max. What happens if they change nothing. What's possible if they do. End with one direct sentence that leads into booking a call.]`
    }]
  });
  return response.content[0].text;
}

async function sendEmail(toEmail, name, reportContent) {
  await resend.emails.send({
    from: "onboarding@resend.dev",
    to: toEmail,
    subject: `${name}, your Primal Span assessment is ready`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;color:#111;">
        <div style="margin-bottom:28px;">
          <span style="font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:#888;">
            Primal Span
          </span>
        </div>
        <h2 style="font-size:22px;font-weight:600;margin:0 0 8px;">
          Your longevity assessment, ${name}
        </h2>
        <p style="font-size:14px;color:#666;margin:0 0 32px;">
          No fluff. Just what you need to know.
        </p>
        <div style="white-space:pre-wrap;line-height:1.8;font-size:15px;color:#222;">
          ${reportContent.replace(/\n/g, "<br>")}
        </div>
        <div style="margin-top:48px;padding:28px;background:#f8f8f8;border-radius:8px;border-left:3px solid #111;">
          <p style="margin:0 0 6px;font-size:16px;font-weight:600;">
            Ready to fix this?
          </p>
          <p style="margin:0 0 20px;font-size:14px;color:#555;">
            Book a free 30-minute call. We'll build your 90-day Primal Span protocol.
          </p>
          <a href="https://calendly.com/luisdizon7/30min"
             style="display:inline-block;background:#111;color:#fff;padding:12px 28px;
                    border-radius:6px;text-decoration:none;font-size:14px;font-weight:500;
                    letter-spacing:0.02em;">
            Book your free call →
          </a>
        </div>
        <p style="margin-top:32px;font-size:12px;color:#aaa;">
          Primal Span · You received this because you completed our health assessment.
        </p>
      </div>
    `,
  });
}

app.post("/intake", async (req, res) => {
  res.sendStatus(200);

  try {
    const { fields } = req.body.data;

    console.log("Received fields:", JSON.stringify(fields, null, 2));

    const intake = {
      name:          getFieldByLabel(fields, "name"),
      email:         getField(fields, "INPUT_EMAIL"),
      age:           getFieldByLabel(fields, "age"),
      goals:         getFieldByLabel(fields, "goals"),
      sleepHours:    getFieldByLabel(fields, "hours of sleep"),
      sleepQuality:  getFieldByLabel(fields, "sleep quality"),
      energyPattern: getFieldByLabel(fields, "energy"),
      caffeine:      getFieldByLabel(fields, "caffeine"),
      stressLevel:   getFieldByLabel(fields, "stress"),
      exerciseDays:  getFieldByLabel(fields, "exercise"),
      supplements:   getFieldByLabel(fields, "supplements") || "none",
      notes:         getFieldByLabel(fields, "anything else") || "none",
    };

    console.log("Parsed intake:", JSON.stringify(intake, null, 2));

    if (!intake.email) {
      console.log("No email found — cannot send report");
      return;
    }

    const report = await generateReport(intake);
    await sendEmail(intake.email, intake.name, report);
    console.log(`Report sent to ${intake.email}`);

  } catch (err) {
    console.error("Error processing intake:", err);
  }
});

app.listen(3000, () => console.log("Intake server running on port 3000"));
