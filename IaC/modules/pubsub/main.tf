// Topic + push subscription + dead-letter topic/subscription, for an
// async request pipeline where the publisher (trpc-api) and the consumer
// (a standalone Cloud Run worker) must never share a process or a failure
// domain — see services/trpc-api/src/services/dataExportRequestService.ts
// and services/data-export-service/src/services/exportGenerationService.ts
// for the app-side half of this. Named generically (not
// "data-export-pubsub") since the shape — publish-only caller, isolated
// push-subscribed worker, bounded retry then dead-letter — is reusable for
// any future async pipeline built the same way, not just this one.

data "google_project" "this" {
  project_id = var.project_id
}

// Every Pub/Sub project has this agent (created automatically the first
// time the API is used) — needed below for the dead-letter forwarding
// grants and the push OIDC token-minting grant. Not something this module
// creates, just references by its well-known, deterministic email.
locals {
  pubsub_service_agent = "service-${data.google_project.this.number}@gcp-sa-pubsub.iam.gserviceaccount.com"
  push_audience        = coalesce(var.push_audience, var.push_endpoint)
}

resource "google_pubsub_topic" "main" {
  project = var.project_id
  name    = "${var.topic_name}-${var.environment}"

  message_retention_duration = var.message_retention_duration
}

resource "google_pubsub_topic" "dead_letter" {
  project = var.project_id
  name    = "${var.topic_name}-dead-letter-${var.environment}"

  message_retention_duration = var.message_retention_duration
}

resource "google_pubsub_subscription" "main_push" {
  project = var.project_id
  name    = "${var.topic_name}-push-${var.environment}"
  topic   = google_pubsub_topic.main.id

  ack_deadline_seconds = var.ack_deadline_seconds

  push_config {
    push_endpoint = var.push_endpoint

    oidc_token {
      service_account_email = var.push_service_account_email
      audience              = local.push_audience
    }
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter.id
    max_delivery_attempts = var.max_delivery_attempts
  }

  # Bounded retry backoff — the default Pub/Sub applies is fine, but
  # explicit here so max_delivery_attempts above (a small number, 5)
  # isn't burned through in seconds by an unbounded-looking retry storm.
  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "300s"
  }
}

resource "google_pubsub_subscription" "dead_letter_push" {
  project = var.project_id
  name    = "${var.topic_name}-dead-letter-push-${var.environment}"
  topic   = google_pubsub_topic.dead_letter.id

  ack_deadline_seconds = var.ack_deadline_seconds

  push_config {
    push_endpoint = var.dead_letter_push_endpoint

    oidc_token {
      service_account_email = var.push_service_account_email
      audience              = local.push_audience
    }
  }

  # No dead_letter_policy here — this subscription IS the terminal end of
  # the retry chain. A failure handling a dead-lettered message just
  # retries against Pub/Sub's own default subscription-level backoff,
  # indefinitely; that handler (markExportFailedFromDeadLetter) is a
  # trivial DB update with nothing meaningful left to escalate to.
}

// Additive per-member grants (same convention as modules/kms/modules/secrets)
// — only the services that actually publish get this, never a project-wide
// binding.
resource "google_pubsub_topic_iam_member" "publishers" {
  for_each = toset(var.publisher_members)

  project = var.project_id
  topic   = google_pubsub_topic.main.name
  role    = "roles/pubsub.publisher"
  member  = each.value
}

// Two grants required for the dead-letter forwarding mechanism itself to
// work at all (documented Pub/Sub requirement, not specific to this
// pipeline): the Pub/Sub service agent needs publish rights on the
// dead-letter topic, and subscribe rights on the *original* subscription
// it's forwarding out of.
resource "google_pubsub_topic_iam_member" "dead_letter_publisher" {
  project = var.project_id
  topic   = google_pubsub_topic.dead_letter.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${local.pubsub_service_agent}"
}

resource "google_pubsub_subscription_iam_member" "dead_letter_subscriber" {
  project      = var.project_id
  subscription = google_pubsub_subscription.main_push.name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:${local.pubsub_service_agent}"
}

// Lets the Pub/Sub service agent actually mint the OIDC tokens it attaches
// to every push request — without this, both push subscriptions above
// would fail to deliver anything at all. This module only grants the
// permission; it doesn't create var.push_service_account_email, and it
// doesn't grant that SA roles/run.invoker on whatever Cloud Run service
// receives the pushes (see push_service_account_email's own doc comment).
resource "google_service_account_iam_member" "push_token_creator" {
  service_account_id = "projects/${var.project_id}/serviceAccounts/${var.push_service_account_email}"
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${local.pubsub_service_agent}"
}
