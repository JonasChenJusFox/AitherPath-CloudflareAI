const [to, subject, ...bodyParts] = process.argv.slice(2);

const baseUrl =
  process.env.WORKINGHELPER_BASE_URL || "https://workinghelper.com";
const cookie = process.env.WORKINGHELPER_COOKIE;
const body = bodyParts.join(" ");

if (!to || !subject || !body) {
  console.error(
    "Usage: WORKINGHELPER_COOKIE='...' npm run send:test-email -- recipient@example.com 'Subject' 'Email body'"
  );
  process.exit(1);
}

if (!cookie) {
  console.error(
    "Missing WORKINGHELPER_COOKIE. Connect Gmail in the browser first, then provide the workinghelper.com Cookie header."
  );
  process.exit(1);
}

const response = await fetch(`${baseUrl}/api/gmail/send`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Cookie: cookie
  },
  body: JSON.stringify({
    to,
    subject,
    body
  })
});

const result = await response.json();

if (!response.ok) {
  console.error("Email send failed:");
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log("Email sent:");
console.log(JSON.stringify(result, null, 2));
