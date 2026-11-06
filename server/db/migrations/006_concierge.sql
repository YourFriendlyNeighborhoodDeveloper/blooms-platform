-- Flora, the AI concierge: conversations and transcripts, inquiry drafts, the owner's knowledge
-- base, identity checks, and staff tickets with priorities, acknowledgment and escalation.
--
-- Flora reads and writes only through scoped server functions. Nothing here gives the model a
-- query of its own. Demonstration conversations are marked sandbox and never become business
-- records: a sandbox draft is submitted into the sandbox, not into the wedding pipeline.

ALTER TABLE access_tokens DROP CONSTRAINT access_tokens_purpose_check;
ALTER TABLE access_tokens ADD CONSTRAINT access_tokens_purpose_check CHECK (purpose IN (
  'staff_invite', 'password_reset', 'customer_login', 'order_access', 'inquiry_access',
  'quote_access', 'invoice_access', 'project_access', 'preferences', 'calendar_feed', 'review_action',
  'concierge_draft', 'voice_stream'
));

CREATE TABLE concierge_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  channel text NOT NULL CHECK (channel IN ('chat', 'voice')),
  -- demo: fictional sandbox, no access to real customer records. customer: the real business.
  mode text NOT NULL CHECK (mode IN ('demo', 'customer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'failed')),
  -- Chat: the browser keeps a secret that continues this conversation. Only its hash is stored.
  client_token_hash text UNIQUE,
  -- Voice: Twilio's call id and the number Twilio reported. A caller ID is never proof of identity.
  call_sid text UNIQUE,
  caller_phone_e164 text,
  model text,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  end_reason text,
  turns integer NOT NULL DEFAULT 0,
  tool_calls integer NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  cached_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  audio_input_tokens bigint NOT NULL DEFAULT 0,
  audio_output_tokens bigint NOT NULL DEFAULT 0,
  call_seconds integer,
  -- Estimated provider cost, in millionths of a US dollar, from the published per-token rates.
  est_cost_micros bigint NOT NULL DEFAULT 0,
  texts_sent integer NOT NULL DEFAULT 0,
  outcome text,
  converted_inquiry_id uuid REFERENCES wedding_inquiries(id) ON DELETE SET NULL,
  ip_hash text,
  user_agent text,
  transcript_purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX concierge_conversations_started_idx ON concierge_conversations (started_at DESC);
CREATE INDEX concierge_conversations_caller_idx ON concierge_conversations (caller_phone_e164, started_at DESC) WHERE caller_phone_e164 IS NOT NULL;
CREATE INDEX concierge_conversations_active_idx ON concierge_conversations (channel, status) WHERE status = 'active';

CREATE TABLE concierge_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position bigint GENERATED ALWAYS AS IDENTITY,
  conversation_id uuid NOT NULL REFERENCES concierge_conversations(id) ON DELETE CASCADE,
  -- customer: what the person typed or said. assistant: Flora's words. tool: a backend call and
  -- its result. event: something that happened, such as a consent or a limit being reached.
  role text NOT NULL CHECK (role IN ('customer', 'assistant', 'tool', 'event')),
  content text,
  tool_name text,
  tool_call_id text,
  tool_args jsonb,
  tool_result jsonb,
  -- The server refused this tool call: wrong mode, not verified, or invalid arguments.
  refused boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX concierge_messages_conversation_idx ON concierge_messages (conversation_id, position);

CREATE TABLE concierge_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  conversation_id uuid REFERENCES concierge_conversations(id) ON DELETE SET NULL,
  sandbox boolean NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'expired')),
  -- Planner fields gathered so far, in the planner's own shape. Validated again on submission.
  data jsonb NOT NULL DEFAULT '{}',
  contact_name text,
  contact_email citext,
  contact_phone_e164 text,
  preferred_consultation_at timestamptz,
  -- When no text message can be sent, a six-digit code continues the plan on the website.
  continue_code_hash text,
  continue_code_expires_at timestamptz,
  continue_failures integer NOT NULL DEFAULT 0,
  link_sent_at timestamptz,
  link_channel text,
  -- Customer mode: the real inquiry created on submission. Sandbox: the estimate and date check.
  inquiry_id uuid REFERENCES wedding_inquiries(id) ON DELETE SET NULL,
  sandbox_result jsonb,
  submitted_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (sandbox AND inquiry_id IS NOT NULL))
);
CREATE INDEX concierge_drafts_conversation_idx ON concierge_drafts (conversation_id);
CREATE INDEX concierge_drafts_status_idx ON concierge_drafts (sandbox, status, created_at DESC);
CREATE UNIQUE INDEX concierge_drafts_code_idx ON concierge_drafts (continue_code_hash) WHERE continue_code_hash IS NOT NULL;

-- What the owner wants Flora to know. Flora may only state business facts from here or from
-- the business settings, never from its own general knowledge.
CREATE TABLE concierge_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  keywords text NOT NULL DEFAULT '',
  published boolean NOT NULL DEFAULT false,
  is_demo boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  search tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, title || ' ' || body || ' ' || keywords)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX concierge_knowledge_search_idx ON concierge_knowledge USING gin (search);

-- A one-time code sent to the contact details already on an order. Saying a name, or calling
-- from a number, is never enough to see an order.
CREATE TABLE concierge_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES concierge_conversations(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  failures integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX concierge_verifications_conversation_idx ON concierge_verifications (conversation_id, created_at DESC);

-- Staff tickets. Website messages and Flora's requests share one queue.
ALTER TABLE support_requests ALTER COLUMN email DROP NOT NULL;
ALTER TABLE support_requests ADD CONSTRAINT support_requests_contact_check CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL);
ALTER TABLE support_requests ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
ALTER TABLE support_requests ADD COLUMN category text NOT NULL DEFAULT 'general';
ALTER TABLE support_requests ADD COLUMN conversation_id uuid REFERENCES concierge_conversations(id) ON DELETE SET NULL;
ALTER TABLE support_requests ADD COLUMN acknowledged_at timestamptz;
ALTER TABLE support_requests ADD COLUMN acknowledged_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE support_requests ADD COLUMN due_at timestamptz;
ALTER TABLE support_requests ADD COLUMN escalated_at timestamptz;
ALTER TABLE support_requests ADD COLUMN sandbox boolean NOT NULL DEFAULT false;
CREATE INDEX support_requests_escalation_idx ON support_requests (due_at) WHERE status <> 'closed' AND acknowledged_at IS NULL AND escalated_at IS NULL;
