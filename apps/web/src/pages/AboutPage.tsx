export function AboutPage() {
  return (
    <section className="about-page" aria-labelledby="about-title" aria-describedby="about-description">
      <header className="about-page__hero">
        <p className="about-page__eyebrow">About Vitana</p>
        <h1 id="about-title">Your Health. Connected.</h1>
        <div id="about-description" className="about-page__intro">
          <p>
            Health information has never been more available than it is today. Yet for most people, their health story is scattered across emails, printed reports, hospital portals, fitness apps, wearable devices, and handwritten notes.
          </p>
          <p>
            A blood test result from three years ago sits in a PDF on a laptop. Body composition reports are tucked away in a folder. Fitness and sleep data live inside separate apps. Important health events are forgotten over time. Preventive care appointments and check-ups are recorded in calendars that rarely tell the full story.
          </p>
          <p>Vitana was created to change that.</p>
        </div>
      </header>

      <div className="about-page__content">
        <section aria-labelledby="why-we-built-vitana">
          <h2 id="why-we-built-vitana">Why We Built Vitana</h2>
          <p>We believe that every person deserves a complete view of their health journey.</p>
          <p>
            For decades, health data has been fragmented. While technology has made it easier to measure our health, it has not made it easier to understand it. Valuable information exists everywhere, but rarely in one place where it can be viewed, tracked, compared, and used effectively.
          </p>
          <p>Vitana brings your health information together into a single source of truth.</p>
          <p>
            Instead of searching through files, emails, apps, and reports, everything that matters lives in one secure, organized platform. Your health history becomes accessible, understandable, and actionable.
          </p>
        </section>

        <section aria-labelledby="complete-health-story">
          <h2 id="complete-health-story">One Place for Your Complete Health Story</h2>
          <p>Vitana is designed to centralize the most important aspects of your health and wellbeing.</p>

          <div className="about-page__capabilities">
            <section className="about-page__capability" aria-labelledby="blood-test-results">
              <h3 id="blood-test-results">Blood Test Results</h3>
              <p>Import laboratory results from healthcare providers or enter them manually.</p>
              <p>
                Track health markers over time, compare results across years, identify trends, and build a long-term record of your health. If a specific metric isn't already available, you can create and track your own custom measurements.
              </p>
              <p>No more digging through folders or searching old emails for past test results.</p>
            </section>

            <section className="about-page__capability" aria-labelledby="activity-sleep-fitness">
              <h3 id="activity-sleep-fitness">Activity, Sleep and Fitness Data</h3>
              <p>
                Vitana connects with Health Connect and integrates data from many popular health devices and platforms, including smart watches, fitness trackers, and wearable health technology.
              </p>
              <p>Monitor:</p>
              <ul>
                <li>Activity levels</li>
                <li>Sleep patterns</li>
                <li>Exercise trends</li>
                <li>Heart and wellness metrics</li>
                <li>Other connected health data</li>
              </ul>
              <p>Rather than viewing this information in separate applications, Vitana unifies it within your personal health profile.</p>
            </section>

            <section className="about-page__capability" aria-labelledby="body-composition-tracking">
              <h3 id="body-composition-tracking">Body Composition Tracking</h3>
              <p>
                Whether your data comes from a digital smart scale at home or professional body composition assessments at a gym or clinic, Vitana helps you maintain a complete history.
              </p>
              <p>Track metrics such as:</p>
              <ul>
                <li>Body weight</li>
                <li>Body fat percentage</li>
                <li>Muscle mass</li>
                <li>Water composition</li>
                <li>Bone mass</li>
                <li>Other body composition measurements</li>
              </ul>
              <p>As your data grows, Vitana visualizes changes over time, helping you better understand your progress and overall health.</p>
            </section>
          </div>
        </section>

        <section aria-labelledby="bigger-picture">
          <h2 id="bigger-picture">See the Bigger Picture</h2>
          <p>Health metrics rarely exist in isolation.</p>
          <p>
            A change in activity may impact sleep quality. Improvements in body composition may influence blood markers. Illness, lifestyle changes, medications, and treatments can all affect multiple aspects of your health simultaneously.
          </p>
          <p>Vitana helps connect these pieces together.</p>
          <p>
            By viewing your health information side-by-side, you gain a deeper understanding of how different factors influence your wellbeing over time. This holistic view can support better conversations with healthcare providers and more informed personal health decisions.
          </p>
        </section>

        <section aria-labelledby="built-around-you">
          <h2 id="built-around-you">Built Around You</h2>
          <p>Every health journey is unique.</p>
          <p>That's why Vitana is designed to be flexible and customizable.</p>
          <p>Beyond standard health metrics, users can record important life and health events, including:</p>
          <ul>
            <li>Medical procedures</li>
            <li>Imaging and diagnostic tests</li>
            <li>Vaccinations</li>
            <li>Illnesses and recoveries</li>
            <li>Dental treatments</li>
            <li>Personal health milestones</li>
            <li>Custom health observations</li>
          </ul>
          <p>If something matters to your health journey, Vitana gives you a way to track it.</p>
        </section>

        <section aria-labelledby="stay-on-top-of-care">
          <h2 id="stay-on-top-of-care">Stay on Top of Your Care</h2>
          <p>Health isn't just about recording information. It's also about staying proactive.</p>
          <p>Vitana's Care feature helps you manage upcoming and recurring health activities, including:</p>
          <ul>
            <li>Health check-ups</li>
            <li>Blood tests</li>
            <li>Vaccinations and immunizations</li>
            <li>Dental appointments</li>
            <li>Screening programs</li>
            <li>Medication plans</li>
            <li>Follow-up visits</li>
          </ul>
          <p>You'll receive reminders for upcoming care activities and can easily track completed appointments, creating a lasting record of your preventive healthcare journey.</p>
        </section>

        <section aria-labelledby="whole-family">
          <h2 id="whole-family">Designed for the Whole Family</h2>
          <p>Vitana is more than a personal health tracker.</p>
          <p>You can manage health information for your entire family, including children and even pets.</p>
          <p>This makes it easier to keep important health records, appointments, vaccinations, and care plans organized in one place for everyone who matters most.</p>
        </section>

        <section aria-labelledby="ai-powered-insights">
          <h2 id="ai-powered-insights">AI-Powered Health Insights</h2>
          <p>Collecting data is only the first step. Understanding it is where the real value begins.</p>
          <p>Vitana includes AI-powered capabilities that help turn information into insight.</p>
          <p>You can ask questions in plain language, such as:</p>
          <ul>
            <li>"How has my iron level changed over the past five years?"</li>
            <li>"Did my activity levels decrease during the months when my sleep quality dropped?"</li>
            <li>"What trends can you see in my recent blood test results?"</li>
          </ul>
          <p>Rather than manually searching through years of records, Vitana helps you uncover meaningful patterns instantly.</p>
        </section>

        <section aria-labelledby="biological-age-intelligence">
          <h2 id="biological-age-intelligence">Biological Age Intelligence</h2>
          <p>Vitana also provides biological age insights based on selected health markers and evidence-based research models.</p>
          <p>While chronological age tells you how many years you've lived, biological age provides a broader perspective on how your body may be ageing based on measurable health indicators.</p>
          <p>By monitoring changes over time, users can better understand the impact of lifestyle, health interventions, and wellness improvements on their overall health trajectory.</p>
        </section>

        <section className="about-page__vision" aria-labelledby="future-of-personal-health">
          <h2 id="future-of-personal-health">Building the Future of Personal Health</h2>
          <p>Vitana represents a new approach to health management.</p>
          <p>
            We envision a world where people have complete ownership of their health story. A world where important health information is no longer fragmented across dozens of platforms. A world where data is not only stored, but organized, connected, and transformed into meaningful insights.
          </p>
          <p>Our mission is simple:</p>
          <p className="about-page__mission">
            To help people understand their health, stay proactive in their care, and make better decisions through a complete, connected view of their wellbeing.
          </p>
          <p>Because when everything comes together, better health decisions become possible. And that's where healthier lives begin.</p>
        </section>
      </div>
    </section>
  );
}
