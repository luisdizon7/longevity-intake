import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { Resend } from "resend";

const app = express();
app.use(express.json());

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);
const KIT_API_KEY = process.env.KIT_API_KEY;

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

function extractScore(reportContent) {
  const match = reportContent.match(/PRIMAL SPAN SCORE:\s*(\d+)/i);
  return match ? parseInt(match[1]) : 50;
}

function getScoreColor(score) {
  if (score >= 75) return "#22c55e";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

function getScoreLabel(score) {
  if (score >= 75) return "STRONG";
  if (score >= 50) return "MODERATE";
  return "CRITICAL";
}

async function subscribeToKit(email, name) {
  try {
    // Step 1 — create or update subscriber
    const subResponse = await fetch("https://api.kit.com/v4/subscribers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Kit-Api-Key": KIT_API_KEY,
      },
      body: JSON.stringify({
        email_address: email,
        first_name: name,
      }),
    });
    const subData = await subResponse.json();
    console.log("Kit subscriber response:", JSON.stringify(subData, null, 2));

    const subscriberId = subData?.subscriber?.id
      || subData?.data?.subscriber?.id
      || subData?.id;

    if (!subscriberId) {
      console.log("Could not find subscriber ID — skipping tag");
      return;
    }
    console.log("Kit subscriber ID:", subscriberId);

    // Step 2 — get or create tag
    const tagResponse = await fetch("https://api.kit.com/v4/tags", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Kit-Api-Key": KIT_API_KEY,
      },
      body: JSON.stringify({ name: "primal-span-lead" }),
    });
    const tagData = await tagResponse.json();
    console.log("Kit tag response:", JSON.stringify(tagData, null, 2));

    const tagId = tagData?.tag?.id
      || tagData?.data?.tag?.id
      || tagData?.id;

    if (!tagId) {
      console.log("Could not find tag ID — skipping tag add");
      return;
    }
    console.log("Kit tag ID:", tagId);

    // Step 3 — add subscriber to tag (correct V4 endpoint)
    const tagAddResponse = await fetch(
      `https://api.kit.com/v4/tags/${tagId}/subscribers`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Kit-Api-Key": KIT_API_KEY,
        },
        body: JSON.stringify({ subscriber_id: subscriberId }),
      }
    );
    const tagAddData = await tagAddResponse.json();
    console.log("Tag add response:", JSON.stringify(tagAddData, null, 2));
    console.log("Tag successfully added to subscriber");

  } catch (err) {
    console.error("Kit subscription error:", err);
  }
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
Exercise: ${intake.exerciseDays} days/week, type: ${intake.exerciseType}
Diet: ${intake.diet}
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
  const score = extractScore(reportContent);
  const scoreColor = getScoreColor(score);
  const scoreLabel = getScoreLabel(score);

  const formattedReport = reportContent
    .replace(/\*\*(.*?)\*\*/g, '<span style="color:#fff;font-weight:700;">$1</span>')
    .replace(/^PRIMAL SPAN SCORE:.*$/m, '')
    .replace(/^(YOUR BIGGEST PROBLEM RIGHT NOW)$/m,
      '<div style="color:#6b7280;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin:32px 0 8px;">$1</div>')
    .replace(/^(THE 4 PILLARS — YOUR BREAKDOWN)$/m,
      '<div style="color:#6b7280;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin:32px 0 8px;">$1</div>')
    .replace(/^(SLEEP|NUTRITION|MOVEMENT|STRESS)$/gm,
      '<div style="color:#fff;font-size:16px;font-weight:700;margin:24px 0 4px;">$1</div>')
    .replace(/^(BOTTOM LINE)$/m,
      '<div style="color:#6b7280;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;margin:32px 0 8px;">$1</div>')
    .replace(/^(Status: .+)$/gm,
      '<div style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:0.08em;padding:3px 10px;border-radius:4px;background:#1f2937;color:#9ca3af;margin-bottom:8px;">$1</div>')
    .replace(/^(Fix this week:.+)$/gm,
      `<div style="border-left:3px solid ${scoreColor};padding:8px 12px;margin:12px 0;color:#d1d5db;font-size:14px;">$1</div>`)
    .replace(/^---$/gm, '<div style="height:1px;background:#1f2937;margin:16px 0;"></div>')
    .replace(/\n/g, "<br>");

  await resend.emails.send({
    from: "onboarding@resend.dev",
    to: toEmail,
    subject: `${name}, your Primal Span score: ${score}/100`,
    html: `
      <div style="background:#000;min-height:100vh;padding:0;margin:0;">
        <div style="max-width:600px;margin:0 auto;padding:48px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">

          <div style="margin-bottom:40px;border-bottom:1px solid #1f2937;padding-bottom:32px;">
            <div style="font-size:32px;font-weight:900;color:#fff;letter-spacing:0.15em;text-transform:uppercase;margin-bottom:4px;">
              PRIMAL SPAN
            </div>
            <div style="font-size:12px;color:#6b7280;letter-spacing:0.1em;text-transform:uppercase;">
              Longevity Assessment Report
            </div>
          </div>

          <p style="font-size:15px;color:#9ca3af;margin:0 0 32px;">
            Prepared for <span style="color:#fff;font-weight:600;">${name}</span> · No fluff. Just what you need to know.
          </p>

          <div style="background:#0a0a0a;border:1px solid #1f2937;border-radius:12px;padding:28px;margin-bottom:40px;">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;">
              <div>
                <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#6b7280;margin-bottom:6px;">
                  YOUR SCORE
                </div>
                <div style="font-size:64px;font-weight:900;color:${scoreColor};line-height:1;letter-spacing:-2px;">
                  ${score}<span style="font-size:28px;color:#374151;font-weight:400;">/100</span>
                </div>
              </div>
              <div style="padding-top:8px;">
                <div style="display:inline-block;background:${scoreColor}22;color:${scoreColor};font-size:13px;font-weight:800;letter-spacing:0.12em;padding:8px 16px;border-radius:6px;border:1px solid ${scoreColor}55;text-transform:uppercase;">
                  ${scoreLabel}
                </div>
              </div>
            </div>

            <div style="background:#1f2937;border-radius:99px;height:10px;overflow:hidden;margin-bottom:20px;">
              <div style="background:${scoreColor};width:${score}%;height:100%;border-radius:99px;"></div>
            </div>

            <div style="display:flex;gap:8px;">
              <div style="flex:1;background:#111;border-radius:8px;padding:12px 10px;text-align:center;">
                <div style="font-size:9px;font-weight:800;letter-spacing:0.1em;color:#6b7280;margin-bottom:8px;text-transform:uppercase;">SLEEP</div>
                <div style="width:100%;background:#1f2937;border-radius:99px;height:4px;">
                  <div style="background:${scoreColor};width:${Math.min(100, Math.max(10, score - 5))}%;height:4px;border-radius:99px;"></div>
                </div>
              </div>
              <div style="flex:1;background:#111;border-radius:8px;padding:12px 10px;text-align:center;">
                <div style="font-size:9px;font-weight:800;letter-spacing:0.1em;color:#6b7280;margin-bottom:8px;text-transform:uppercase;">NUTRITION</div>
                <div style="width:100%;background:#1f2937;border-radius:99px;height:4px;">
                  <div style="background:${scoreColor};width:${Math.min(100, Math.max(10, score + 5))}%;height:4px;border-radius:99px;"></div>
                </div>
              </div>
              <div style="flex:1;background:#111;border-radius:8px;padding:12px 10px;text-align:center;">
                <div style="font-size:9px;font-weight:800;letter-spacing:0.1em;color:#6b7280;margin-bottom:8px;text-transform:uppercase;">MOVEMENT</div>
                <div style="width:100%;background:#1f2937;border-radius:99px;height:4px;">
                  <div style="background:${scoreColor};width:${Math.min(100, Math.max(10, score - 10))}%;height:4px;border-radius:99px;"></div>
                </div>
              </div>
              <div style="flex:1;background:#111;border-radius:8px;padding:12px 10px;text-align:center;">
                <div style="font-size:9px;font-weight:800;letter-spacing:0.1em;color:#6b7280;margin-bottom:8px;text-transform:uppercase;">STRESS</div>
                <div style="width:100%;background:#1f2937;border-radius:99px;height:4px;">
                  <div style="background:${scoreColor};width:${Math.min(100, Math.max(10, score + 10))}%;height:4px;border-radius:99px;"></div>
                </div>
              </div>
            </div>
          </div>

          <div style="color:#d1d5db;font-size:15px;line-height:1.8;">
            ${formattedReport}
          </div>

          <div style="margin-top:48px;background:#0a0a0a;border:1px solid #1f2937;border-radius:12px;padding:32px;text-align:center;">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#6b7280;margin-bottom:12px;">
              NEXT STEP
            </div>
            <h2 style="font-size:22px;font-weight:700;color:#fff;margin:0 0 10px;">
              Ready to fix this?
            </h2>
            <p style="font-size:14px;color:#6b7280;margin:0 0 24px;line-height:1.6;">
              Book a free 30-minute call. We'll build your<br>90-day Primal Span protocol together.
            </p>
            <a href="https://calendly.com/luisdizon7/30min"
               style="display:inline-block;background:#fff;color:#000;padding:14px 36px;
                      border-radius:8px;text-decoration:none;font-size:14px;font-weight:800;
                      letter-spacing:0.06em;text-transform:uppercase;">
              Book your free call →
            </a>
          </div>

          <div style="margin-top:32px;text-align:center;border-top:1px solid #111;padding-top:24px;">
            <div style="font-size:13px;font-weight:800;letter-spacing:0.15em;color:#374151;margin-bottom:6px;">
              PRIMAL SPAN
            </div>
            <p style="font-size:12px;color:#374151;margin:0;">
              You received this because you completed our health assessment.
            </p>
          </div>

        </div>
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
      exerciseDays:  getFieldByLabel(fields, "days a week"),
      exerciseType:  getFieldByLabel(fields, "type of exercise") || "not provided",
      diet:          getFieldByLabel(fields, "diet") || "not provided",
      supplements:   getFieldByLabel(fields, "supplements") || "none",
      notes:         getFieldByLabel(fields, "anything else") || "none",
    };

    console.log("Parsed intake:", JSON.stringify(intake, null, 2));

    if (!intake.email) {
      console.log("No email found — cannot send report");
      return;
    }

    const [report] = await Promise.all([
      generateReport(intake),
      subscribeToKit(intake.email, intake.name),
    ]);

    await sendEmail(intake.email, intake.name, report);
    console.log(`Report sent and Kit tagged for ${intake.email}`);

  } catch (err) {
    console.error("Error processing intake:", err);
  }
});

app.listen(3000, () => console.log("Intake server running on port 3000"));
