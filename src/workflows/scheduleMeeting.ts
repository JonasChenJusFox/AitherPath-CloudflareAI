import { AgentWorkflow } from "agents/workflows";
import type { AgentWorkflowEvent, AgentWorkflowStep } from "agents/workflows";
import type { ChatAgent } from "../server";
import type { CreateCalendarEventInput } from "../google/calendar";

export type ScheduleMeetingWorkflowParams = {
  contactQuery: string;
  summary: string;
  startDateTime: string;
  endDateTime: string;
  timeZone: string;
  description?: string;
  location?: string;
  overwriteExisting?: boolean;
  sendNotification?: boolean;
};

export class ScheduleMeetingWorkflow extends AgentWorkflow<
  ChatAgent,
  ScheduleMeetingWorkflowParams
> {
  async run(
    event: AgentWorkflowEvent<ScheduleMeetingWorkflowParams>,
    step: AgentWorkflowStep
  ) {
    const input = event.payload;
    await this.reportProgress({
      step: "contact",
      status: "running",
      message: "Searching the contact.",
      percent: 0.15
    });

    const contactResult = await step.do(
      "search-contact",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } },
      async () => {
        const result = (await this.agent.workflowSearchContact(
          input.contactQuery
        )) as unknown as { displayName: string; email: string };
        return { displayName: result.displayName, email: result.email };
      }
    );
    const contact = {
      displayName: String(contactResult.displayName),
      email: String(contactResult.email)
    };

    await this.reportProgress({
      step: "availability",
      status: "running",
      message: "Checking calendar availability.",
      percent: 0.35
    });

    const conflicts = await step.do(
      "check-availability",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } },
      async () => {
        const result = (await this.agent.workflowCheckAvailability({
          startDateTime: input.startDateTime,
          endDateTime: input.endDateTime,
          timeZone: input.timeZone
        })) as unknown as Array<{
          id: string;
          summary: string;
          start: string;
          end: string;
        }>;
        return result.map((event) => ({
          id: String(event.id),
          summary: String(event.summary),
          start: String(event.start),
          end: String(event.end)
        }));
      }
    );

    if (conflicts.length > 0 && !input.overwriteExisting) {
      await step.reportError(
        "The selected time is busy. Ask the user whether to overwrite the existing event before retrying."
      );
      throw new Error("The selected time is busy.");
    }

    await this.reportProgress({
      step: "calendar",
      status: "running",
      message: "Creating the calendar event.",
      percent: 0.65
    });

    const eventInput: CreateCalendarEventInput = {
      summary: input.summary,
      description: input.description,
      location: input.location,
      startDateTime: input.startDateTime,
      endDateTime: input.endDateTime,
      timeZone: input.timeZone,
      attendeeEmails: [contact.email],
      sendUpdates: "all"
    };

    const calendarEvent = await step.do(
      "create-calendar-event",
      { retries: { limit: 3, delay: "3 seconds", backoff: "exponential" } },
      async () => {
        const result = (await this.agent.workflowCreateMeeting({
          event: eventInput,
          conflicts,
          overwriteExisting: input.overwriteExisting ?? false
        })) as unknown as {
          id: string;
          summary: string;
          start: string;
          end: string;
          htmlLink: string;
        };
        return {
          id: String(result.id),
          summary: String(result.summary),
          start: String(result.start),
          end: String(result.end),
          htmlLink: String(result.htmlLink)
        };
      }
    );

    let notification: unknown = null;
    if (input.sendNotification !== false) {
      await this.reportProgress({
        step: "notification",
        status: "running",
        message: "Sending the notification.",
        percent: 0.85
      });
      notification = await step.do(
        "send-notification",
        { retries: { limit: 3, delay: "3 seconds", backoff: "exponential" } },
        async () => {
          const result = (await this.agent.workflowSendNotification({
            to: contact.email,
            subject: input.summary,
            body: `You are invited to ${input.summary} from ${input.startDateTime} to ${input.endDateTime} (${input.timeZone}).`
          })) as unknown as { id: string; threadId: string };
          return { id: String(result.id), threadId: String(result.threadId) };
        }
      );
    }

    const result = { contact, calendarEvent, notification };
    await step.reportComplete(result);
    await this.reportProgress({
      step: "complete",
      status: "complete",
      message: "Meeting workflow completed.",
      percent: 1
    });
    return result;
  }
}
