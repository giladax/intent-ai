"""Customer-facing refund status notifications."""


class EmailClient:
    def send(self, to: str, subject: str, body: str) -> None:
        # Placeholder for the real email integration.
        pass


def send_refund_status_email(client: EmailClient, customer_email: str, decision) -> None:
    if decision.approved:
        subject = "Your refund is on the way"
    elif decision.requires_human_approval:
        subject = "Your refund request is being reviewed"
    else:
        subject = "Update on your refund request"
    client.send(customer_email, subject, decision.reason)
