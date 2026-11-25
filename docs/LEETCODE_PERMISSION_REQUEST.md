# Request to LeetCode: permission to read accepted submissions for consenting students

**Send to:** support@leetcode.com (the contact listed in LeetCode's Terms of Service). Also use the contact form at https://leetcode.com/business if it accepts education inquiries (not verified, I could not load that page).
**Do not** treat silence as permission. Save the written reply, because the live proof of concept requires it as a file.

Fill every `[BRACKET]` before sending.

---

**Subject:** Request for written permission / API access: read-only accepted-submission data for consenting bootcamp students

Hello LeetCode team,

I run [ORGANISATION NAME], which delivers coding bootcamps ([DSA / SQL / language bootcamps]) to college students in [COUNTRY]. Our first program is a [5]-day bootcamp for about 200 students, and we plan to run more across several colleges.

We built a learning platform, Algora, in which trainers assign specific LeetCode problems to students. Students solve those problems **on leetcode.com** (we do not host a coding judge or copy problem statements). We would like the platform to recognise automatically which assigned problems a student has solved, so that trainers can see progress and students can see their own.

**What we are asking for**

1. Written permission to retrieve, for students who have explicitly consented, the list of their recent **accepted** submissions (problem title slug, title, timestamp) from LeetCode's public profile data.
2. If a supported or official method exists (API, partner programme, key, webhook, or an education/enterprise offering), please tell us about it and its terms. We would prefer that to any unofficial access.
3. The request-rate limits you want us to stay within, and any identification requirements.

**What we will and will not do**

- Read-only. Accepted-submission list and solved counts for each consenting student's LeetCode username.
- We do not ask for, store, or use passwords, session cookies, or tokens belonging to students.
- We do not bypass authentication, CAPTCHA, rate limits, or other access controls.
- Each student consents in writing to us reading their public submission data. A student can withdraw at any time and we will stop and delete their stored data on request.
- Requests identify themselves with a User-Agent that names our application and a contact address.
- Volume: about 200 students. Typical load is [0.1 to 0.3] requests per second during an [8-hour] bootcamp day, with a hard cap of [20] requests per minute, one request per student per sync, per-student cooldowns, and exponential backoff on errors. Between syncs we read from our own database, so repeated page views cause no requests to LeetCode.
- We store only the problem slug, title, and timestamp of accepted submissions, and use them to compute progress and a class leaderboard visible to the student's own batch. We do not redistribute the data or use it for any other purpose.

**Details**

- Organisation: [NAME, registration/website]
- Contact: [NAME, ROLE, EMAIL, PHONE]
- Expected start date: [DATE]; expected students: [200] initially, growing to [N].
- Server location / egress: [Railway region], fixed User-Agent `AlgoraSync/1.0 (+[CONTACT EMAIL])`.

If this request should go to a different team or form, please point us to it. Thank you for your time.

[NAME]
[ROLE, ORGANISATION]
[EMAIL]
