// server.js — deploy this to Render or Railway (free tier works)
import express from "express";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
app.use(express.json());

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Helper: extract answer by field type from Typeform payload
function getAnswer(answers, fieldId) {
  const a = answers?.find((ans) => ans.field.ref === fieldId);
  if (!a) return null;
  if (a.type === "text" || a.type === "email") return a.text || a.email;
  if (a.type === "number") return a.number;
  if (a.type === "opinion_scale" || a.type === "rating") return a.number;
  if (a.type === "choice") return a.choice?.label;
  if (a.type === "choices") return a.choices?.labels?.join(", ");
  return null;
}

// Main webhook endpoint — Typeform POSTs here on every submission
app.post("/intake", async (req, res) => {
  res.sendStatus(200); // Acknowledge immediately so Typeform doesn't retry

  const { answers, hidden } = req.body.form_response;

  // Map your Typeform field refs to readable values
  // (set field "ref" names in Typeform's question settings)
  const intake = {
    name:        getAnswer(answers, "name"),
    email:       getAnswer(answers, "email"),
    age:         getAnswer(answers, "age"),
    goals:       getAnswer(answers, "goals"),
    sleepHours:  getAnswer(answers, "sleep_hours"),
    sleepQuality:getAnswer(answers, "sleep_quality"),
    energyPattern:getAnswer(answers, "energy_pattern"),
    caffeine:    getAnswer(answers, "caffeine"),
    stressLevel: getAnswer(answers, "stress_level"),
    exerciseDays:getAnswer(answers, "exercise_days"),
    supplements: getAnswer(answers, "supplements") || "none",
    notes:       getAnswer(answers, "notes") || "none",
  };

  // Generate personalized health score + recommendations via Claude
  const report = await generateReport(intake);

  // Send the report by email
  await sendEmail(intake.email, intake.name, report);

  console.log(`Report sent to ${intake.email}`);
});

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
1. Their personal "longevity score" (out of 100) with a 2-sentence explanation
2. Their top 3 optimization opportunities ranked by impact
3. One quick win they can implement TODAY for each area
4. A 2-sentence encouragement and invitation to book a free discovery call`
    }]
  });

  return response.content[0].text;
}

app.listen(3000, () => console.log("Intake server running on port 3000"));
