import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { Resend } from "resend";

const app = express();
app.use(express.json());

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

function getEmail(answers) {
  const a = answers?.find((ans) => ans.type === "email");
  return a?.email || null;
}

function getName(answers) {
  const a = answers?.find((ans) => ans.type === "text");
  return a?.text || "Friend";
}

function getByIndex(answers, index) {
  return answers?.[index] || null;
}

function extractValue(a) {
  if (!a) return "not provided";
  if (a.type === "text") return a.text;
  if (a.type === "email") return a.email;
  if (a.type === "number") return a.number;
  if (a.type === "opinion_scale" || a.type === "rating") return a.number;
  if (a.type === "choice") return a.choice?.label;
  if (a.type === "choices") return a.choices?.labels?.join(", ");
  if (a.type === "long_text") return a.text;
  return "not provided";
}

async function generateReport(intake) {
  const response = await claude.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: `You are a longevity health coach writing a personalized health 
assessment report. Be warm, specific, and science-backed. Format your response 
in clean sections with clear headers. Never be generic — reference their 
specific answers. End with an encouraging CTA to book a discovery call.`,
    messages: [{
      role: "user",
      content: `Write a personalized longevity health assessment for:

Name: ${intake.name}, Age: ${intake.age}
Goals: ${intake.goals}
Sleep: ${intake.sleepHours} hours/night, quality ${intake.sleepQuality}/10
Energy pattern: ${intake.energyPattern}
Caffeine: ${intake.caffeine} cups/day
Stress: ${intake.stressLevel}/10
Exercise: ${intake.exerciseDays} days/week
Supplements: ${intake.supplements}
Notes: ${intake.notes}

Include:
1. Their personal longevity score (out of 100) with a 2-sentence explanation
2. Their top 3 optimization opportunities ranked by impact
3. One quick win they can implement TODAY for each area
4. A 2-sentence encouragement and invitation to book a free discovery call`
    }]
  });
  return response.content[0].text;
}

async function sendEmail(toEmail, name, reportContent) {
  await resend.emails.send({
    from: "onboarding@resend.dev",
    to: toEmail,
    subject: `${name}, your personalized longevity assessment is ready`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 24px;">
        <h2 style="font-weight:500;margin-bottom:24px;">
          Hi ${name}, here is your longevity assessment
        </h2>
        <div style="white-space:pre-wrap;line-height:1.7;color:#333;">
          ${reportContent.replace(/\n/g, "<br>")}
        </div>
        <div style="margin-top:40px;padding:24px;background:#f5f5f5;border-radius:8px;">
          <p style="margin:0 0 16px;font-weight:500;">
            Ready to build your full 90-day protocol?
          </p>
          <a href="https://calendly.com/yourlink" 
             style="background:#000;color:#fff;padding:12px 24px;
                    border-radius:6px;text-decoration:none;font-size:14px;">
            Book your free discovery call
          </a>
        </div>
      </div>
    `,
  });
}

app.post("/intake", async (req, res) => {
  res.sendStatus(200);

  try {
    const { answers } = req.body.form_response;

    console.log("Received answers:", JSON.stringify(answers, null, 2));

    const intake = {
      name:          getName(answers),
      email:         getEmail(answers),
      age:           extractValue(getByIndex(answers, 1)),
      goals:         extractValue(getByIndex(answers, 2)),
      sleepHours:    extractValue(getByIndex(answers, 3)),
      sleepQuality:  extractValue(getByIndex(answers, 4)),
      energyPattern: extractValue(getByIndex(answers, 5)),
      caffeine:      extractValue(getByIndex(answers, 6)),
      stressLevel:   extractValue(getByIndex(answers, 7)),
      exerciseDays:  extractValue(getByIndex(answers, 8)),
      supplements:   extractValue(getByIndex(answers, 9)) || "none",
      notes:         extractValue(getByIndex(answers, 10)) || "none",
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
