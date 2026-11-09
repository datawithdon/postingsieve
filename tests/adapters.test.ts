// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { adapterFor } from "../src/content/adapters";

const body = "Responsibilities include analysis and reporting. ".repeat(6);
const dom = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("adapterFor", () => {
  it("matches only known hosts", () => {
    expect(adapterFor("https://ca.indeed.com")?.site).toBe("indeed");
    expect(adapterFor("https://www.indeed.com")?.site).toBe("indeed");
    expect(adapterFor("https://secure.indeed.com")).toBeNull();
    expect(adapterFor("https://employers.indeed.com")).toBeNull();
    expect(adapterFor("https://constructor")).toBeNull();
    expect(adapterFor("http://ca.indeed.com")).toBeNull();
    expect(adapterFor("https://www.linkedin.com")?.site).toBe("linkedin");
    expect(adapterFor("https://www.jobbank.gc.ca")?.site).toBe("jobbank");
    expect(adapterFor("https://notindeed.com")).toBeNull();
    expect(adapterFor("https://indeed.com.evil.example")).toBeNull();
  });
});

describe("Job Bank (markup copied from the live site)", () => {
  const a = adapterFor("https://www.jobbank.gc.ca")!;
  it("reads a posting", () => {
    const d = dom(`<main><div class="job-posting-details-body"><h1 class="title"><span property="title">analyst</span></h1><p>${body}</p></div></main>`);
    const p = a.current(d, new URL("https://www.jobbank.gc.ca/jobsearch/jobposting/1000001?source=searchresults"))!;
    expect(p.key).toBe("jobbank:1000001");
    expect(p.title).toBe("analyst");
    expect(p.text).toContain("Responsibilities");
  });
  it("reads a short partner posting and its hidden summary", () => {
    const d = dom(`<div class="job-posting-details-body"><h1 class="title">Analyst</h1><span class="hidden" property="description">Located in Winnipeg</span><p>Winnipeg, SK. On site. 79,849 to 99,811 annually</p></div>`);
    const p = a.current(d, new URL("https://www.jobbank.gc.ca/jobsearch/jobposting/1"))!;
    expect(p.text).toContain("99,811");
    expect(p.text).toContain("Located in Winnipeg");
  });
  it("finds result cards", () => {
    const d = dom(`<article id="article-1000001"><a><h3 class="title">x</h3></a></article>`);
    expect(a.cards(d)).toMatchObject([{ key: "jobbank:1000001" }]);
    expect(a.cards(d)[0]!.mount.tagName).toBe("H3");
  });
  it("ignores other pages", () => expect(a.current(dom(`<main>${body}</main>`), new URL("https://www.jobbank.gc.ca/jobsearch/jobsearch"))).toBeNull());
});

describe("LinkedIn", () => {
  const a = adapterFor("https://www.linkedin.com")!;
  it("reads nothing outside the jobs section, and rejects odd ids", () => {
    expect(a.active(new URL("https://www.linkedin.com/messaging/"))).toBe(false);
    expect(a.active(new URL("https://www.linkedin.com/jobs/search/"))).toBe(true);
    const d = dom(`<main><div class="jobs-details"><h1>Analyst</h1><p>${body}</p></div></main>`);
    expect(a.current(d, new URL("https://www.linkedin.com/jobs/search/?currentJobId=__proto__"))).toBeNull();
  });
  it("takes the id from search-page and view-page URLs", () => {
    const d = dom(`<main><div class="jobs-details"><h1>Analyst</h1><p>${body}</p></div></main>`);
    expect(a.current(d, new URL("https://www.linkedin.com/jobs/search/?currentJobId=123&keywords=x"))?.key).toBe("linkedin:123");
    expect(a.current(d, new URL("https://www.linkedin.com/jobs/view/data-analyst-at-acme-456"))?.key).toBe("linkedin:456");
    expect(a.current(d, new URL("https://www.linkedin.com/feed/"))).toBeNull();
  });
  it("falls back to the About the job heading when class names are hashed", () => {
    const d = dom(`<main><div class="x1"><h1>Analyst</h1><div class="x2"><h2>About the job</h2><div class="x3"><p>${body}</p></div></div></div></main>`);
    const p = a.current(d, new URL("https://www.linkedin.com/jobs/search/?currentJobId=9"))!;
    expect(p.text).toContain("Responsibilities");
    expect(p.title).toBe("Analyst");
  });
  it("includes the signed-out page's top card, where location lives", () => {
    const d = dom(`<main><section class="top-card-layout"><h1 class="top-card-layout__title">Analyst</h1><span>Kingston, Ontario</span></section><div class="decorated-job-posting__details"><p>${body}</p></div></main>`);
    const p = a.current(d, new URL("https://www.linkedin.com/jobs/view/9000000001"))!;
    expect(p.text).toContain("Kingston");
    expect(p.text).toContain("Responsibilities");
    expect(p.title).toBe("Analyst");
  });
  it("finds logged-in and public cards, once each", () => {
    const d = dom(`<li data-occludable-job-id="1"><div data-job-id="1"><a class="job-card-list__title--link">A</a></div></li><div data-entity-urn="urn:li:jobPosting:2"><h3 class="base-search-card__title">B</h3></div>`);
    expect(a.cards(d).map((c) => c.key)).toEqual(["linkedin:1", "linkedin:2"]);
  });
});

describe("Indeed", () => {
  const a = adapterFor("https://ca.indeed.com")!;
  it("includes the header above the description", () => {
    const d = dom(`<div class="jobsearch-JobComponent"><h2 data-testid="jobsearch-JobInfoHeader-title">Analyst</h2><div id="salaryInfoAndJobType">$90,000 a year</div><div id="jobDescriptionText">${body}</div></div>`);
    const p = a.current(d, new URL("https://ca.indeed.com/jobs?q=x&vjk=abc123"))!;
    expect(p.key).toBe("indeed:abc123");
    expect(p.text).toContain("$90,000 a year");
    expect(p.title).toBe("Analyst");
  });
  it("needs a description and an id", () => {
    expect(a.current(dom(`<div id="jobDescriptionText">${body}</div>`), new URL("https://ca.indeed.com/jobs?q=x"))).toBeNull();
    expect(a.current(dom(`<div>${body}</div>`), new URL("https://ca.indeed.com/viewjob?jk=1"))).toBeNull();
  });
  it("finds cards", () => {
    const d = dom(`<h2><a data-jk="abc"><span>Analyst</span></a></h2><a data-jk="abc"></a>`);
    expect(a.cards(d)).toHaveLength(1);
    expect(a.cards(d)[0]!.mount.tagName).toBe("H2");
  });
});
