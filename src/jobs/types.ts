export type JobSource = "jooble" | "linkedin";

export type JobSearchInput = {
  keywords: string;
  location?: string;
  sources?: JobSource[];
  linkedinSessionId?: string;
};

export type JobSummary = {
  title: string;
  company: string;
  location: string;
  link: string;
  source: JobSource;
};

export type ProviderStatus = {
  provider: JobSource;
  status: "ok" | "skipped" | "error";
  message?: string;
};
