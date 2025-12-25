import { SearchObject } from "imapflow";
import { IDataObject, IExecuteFunctions, INodeProperties } from "n8n-workflow";

enum EmailFlags {
  Answered = 'answered',
  Deleted = 'deleted',
  Draft = 'draft',
  Flagged = 'flagged',
  Recent = 'recent',
  Seen = 'seen',
}

enum EmailSearchFilters {
  BCC = 'bcc',
  CC = 'cc',
  From = 'from',
  Subject = 'subject',
  Text = 'text',
  To = 'to',
  UID = 'uid',
}

export const emailSearchParameters: INodeProperties[] = [
  {
    displayName: "Date Range",
    name: "emailDateRange",
    type: "collection",
    placeholder: "Add Date Range",
    default: {
      since: "",
    },
    options: [
      {
        displayName: "Since",
        name: "since",
        type: "dateTime",
        default: "",
        description: "Start date of search",
      },
      {
        displayName: "Before",
        name: "before",
        type: "dateTime",
        default: "",
        description: "End date of search",
      },
    ],
  },
  // flags
  {
    displayName: "Flags",
    name: "emailFlags",
    type: "collection",
    placeholder: "Add Flag",
    default: {},
    options: [
      {
        displayName: "Is Answered",
        name: EmailFlags.Answered,
        type: "boolean",
        default: false,
        description: "Whether email is answered",
      },
      {
        displayName: "Is Deleted",
        name: EmailFlags.Deleted,
        type: "boolean",
        default: false,
        description: "Whether email is deleted",
      },
      {
        displayName: "Is Draft",
        name: EmailFlags.Draft,
        type: "boolean",
        default: false,
        description: "Whether email is draft",
      },
      {
        displayName: "Is Flagged",
        name: EmailFlags.Flagged,
        type: "boolean",
        default: true,
        description: "Whether email is flagged",
      },
      {
        displayName: "Is Recent",
        name: EmailFlags.Recent,
        type: "boolean",
        default: true,
        description: "Whether email is recent",
      },
      {
        displayName: 'Is Seen (Read)',
        name: EmailFlags.Seen,
        type: "boolean",
        default: false,
        description: "Whether email is seen",
        hint: "If true, only seen emails will be returned. If false, only unseen emails will be returned.",
      },
    ],
  },
  {
    displayName: "Search Filters",
    name: "emailSearchFilters",
    type: "collection",
    placeholder: "Add Filter",
    hint: "Search filters are case-insensitive and combined with AND (must match all).",
    default: {},
    options: [
      {
        displayName: "BCC Contains",
        name: EmailSearchFilters.BCC,
        type: "string",
        default: "",
        description: "Email address of BCC recipient",
      },
      {
        displayName: "CC Contains",
        name: EmailSearchFilters.CC,
        type: "string",
        default: "",
        description: "Email address of CC recipient",
      },
      {
        displayName: "From Contains",
        name: EmailSearchFilters.From,
        type: "string",
        default: "",
        description: "Email address of sender",
      },
      {
        displayName: "Subject Contains",
        name: EmailSearchFilters.Subject,
        type: "string",
        default: "",
        description: "Email subject",
      },
      {
        displayName: "Text Contains",
        name: EmailSearchFilters.Text,
        type: "string",
        default: "",
        description: "Search text",
      },
      {
        displayName: "To Contains",
        name: EmailSearchFilters.To,
        type: "string",
        default: "",
        description: "Email address of recipient",
      },
      {
        displayName: "UID",
        name: EmailSearchFilters.UID,
        type: "string",
        default: "",
        description: 'Comma-separated list of UIDs',
        placeholder: '1,2,3',
      },
    ],
  },
];

/**
 * Remove diacritics from a string (e.g., "Objednávka" -> "Objednavka")
 * Uses Unicode normalization to decompose characters, then removes combining marks
 * This is needed for Seznam.cz IMAP which doesn't support non-ASCII in SEARCH
 */
export function removeDiacritics(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Check if string contains non-ASCII characters (e.g., Czech diacritics)
 */
function hasNonAsciiCharacters(str: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[^\x00-\x7F]/.test(str);
}

/**
 * Result of parsing email search parameters with client-side filter support
 */
export interface EmailSearchResult {
  /** SearchObject to send to IMAP server (ASCII-safe, diacritics removed) */
  searchObject: SearchObject;
  /** Original filters for client-side filtering (with diacritics preserved) */
  clientSideFilters: {
    subject?: string;
    from?: string;
    to?: string;
    cc?: string;
    bcc?: string;
    body?: string;
  };
  /** Whether any client-side filtering is needed */
  needsClientSideFiltering: boolean;
}

/**
 * Get email search parameters with client-side filter support for non-ASCII text
 * For IMAP servers that don't support UTF-8 in SEARCH (like Seznam.cz):
 * - Sends ASCII version (diacritics removed) to IMAP for initial filtering
 * - Returns original text for client-side filtering after fetch
 */
export function getEmailSearchParametersWithClientFilters(context: IExecuteFunctions, itemIndex: number): EmailSearchResult {
  const result: EmailSearchResult = {
    searchObject: {},
    clientSideFilters: {},
    needsClientSideFiltering: false,
  };

  // date range
  const emailDateRangeObj = context.getNodeParameter('emailDateRange', itemIndex) as IDataObject;
  const since = emailDateRangeObj['since'] as string;
  const before = emailDateRangeObj['before'] as string;

  if (since) {
    result.searchObject.since = new Date(since);
  }
  if (before) {
    result.searchObject.before = new Date(before);
  }

  // flags - always ASCII-safe
  const emailFlagsObj = context.getNodeParameter('emailFlags', itemIndex) as IDataObject;
  if ('answered' in emailFlagsObj) {
    result.searchObject.answered = emailFlagsObj['answered'] as boolean;
  }
  if ('deleted' in emailFlagsObj) {
    result.searchObject.deleted = emailFlagsObj['deleted'] as boolean;
  }
  if ('draft' in emailFlagsObj) {
    result.searchObject.draft = emailFlagsObj['draft'] as boolean;
  }
  if ('flagged' in emailFlagsObj) {
    result.searchObject.flagged = emailFlagsObj['flagged'] as boolean;
  }
  if ('recent' in emailFlagsObj) {
    const recent = emailFlagsObj['recent'] as boolean;
    if (recent) {
      result.searchObject.recent = true;
    } else {
      result.searchObject.old = true;
    }
  }
  if ('seen' in emailFlagsObj) {
    result.searchObject.seen = emailFlagsObj['seen'] as boolean;
  }

  // search filters - handle non-ASCII characters
  const emailSearchFiltersObj = context.getNodeParameter('emailSearchFilters', itemIndex) as IDataObject;

  // Subject
  if ('subject' in emailSearchFiltersObj) {
    const subject = emailSearchFiltersObj['subject'] as string;
    if (hasNonAsciiCharacters(subject)) {
      // Send ASCII version to IMAP, keep original for client-side filter
      result.searchObject.subject = removeDiacritics(subject);
      result.clientSideFilters.subject = subject;
      result.needsClientSideFiltering = true;
    } else {
      result.searchObject.subject = subject;
    }
  }

  // From
  if ('from' in emailSearchFiltersObj) {
    const from = emailSearchFiltersObj['from'] as string;
    if (hasNonAsciiCharacters(from)) {
      result.searchObject.from = removeDiacritics(from);
      result.clientSideFilters.from = from;
      result.needsClientSideFiltering = true;
    } else {
      result.searchObject.from = from;
    }
  }

  // To
  if ('to' in emailSearchFiltersObj) {
    const to = emailSearchFiltersObj['to'] as string;
    if (hasNonAsciiCharacters(to)) {
      result.searchObject.to = removeDiacritics(to);
      result.clientSideFilters.to = to;
      result.needsClientSideFiltering = true;
    } else {
      result.searchObject.to = to;
    }
  }

  // CC
  if ('cc' in emailSearchFiltersObj) {
    const cc = emailSearchFiltersObj['cc'] as string;
    if (hasNonAsciiCharacters(cc)) {
      result.searchObject.cc = removeDiacritics(cc);
      result.clientSideFilters.cc = cc;
      result.needsClientSideFiltering = true;
    } else {
      result.searchObject.cc = cc;
    }
  }

  // BCC
  if ('bcc' in emailSearchFiltersObj) {
    const bcc = emailSearchFiltersObj['bcc'] as string;
    if (hasNonAsciiCharacters(bcc)) {
      result.searchObject.bcc = removeDiacritics(bcc);
      result.clientSideFilters.bcc = bcc;
      result.needsClientSideFiltering = true;
    } else {
      result.searchObject.bcc = bcc;
    }
  }

  // Text/Body
  if ('text' in emailSearchFiltersObj) {
    const text = emailSearchFiltersObj['text'] as string;
    if (hasNonAsciiCharacters(text)) {
      result.searchObject.body = removeDiacritics(text);
      result.clientSideFilters.body = text;
      result.needsClientSideFiltering = true;
    } else {
      result.searchObject.body = text;
    }
  }

  // UID - always ASCII
  if ('uid' in emailSearchFiltersObj) {
    result.searchObject.uid = emailSearchFiltersObj['uid'] as string;
  }

  return result;
}

export function getEmailSearchParametersFromNode(context: IExecuteFunctions, itemIndex: number): SearchObject {
  var searchObject: SearchObject = {};

  // date range
  const emailDateRangeObj = context.getNodeParameter('emailDateRange', itemIndex) as IDataObject;
  const since = emailDateRangeObj['since'] as string;
  const before = emailDateRangeObj['before'] as string;

  if (since) {
    searchObject.since = new Date(since);
  }
  if (before) {
    searchObject.before = new Date(before);
  }

  // flags
  const emailFlagsObj = context.getNodeParameter('emailFlags', itemIndex) as IDataObject;
  // check if flag exists (could be undefined)
  if (EmailFlags.Answered in emailFlagsObj) {
    searchObject.answered = emailFlagsObj[EmailFlags.Answered] as boolean;
  }
  if (EmailFlags.Deleted in emailFlagsObj) {
    searchObject.deleted = emailFlagsObj[EmailFlags.Deleted] as boolean;
  }
  if (EmailFlags.Draft in emailFlagsObj) {
    searchObject.draft = emailFlagsObj[EmailFlags.Draft] as boolean;
  }
  if (EmailFlags.Flagged in emailFlagsObj) {
    searchObject.flagged = emailFlagsObj[EmailFlags.Flagged] as boolean;
  }
  if (EmailFlags.Recent in emailFlagsObj) {
    const recent = emailFlagsObj[EmailFlags.Recent] as boolean;
    if (recent) {
      searchObject.recent = true;
    } else {
      searchObject.old = true;
    }
  }
  if (EmailFlags.Seen in emailFlagsObj) {
    searchObject.seen = emailFlagsObj[EmailFlags.Seen] as boolean;
  }

  // search filters
  const emailSearchFiltersObj = context.getNodeParameter('emailSearchFilters', itemIndex) as IDataObject;
  if (EmailSearchFilters.BCC in emailSearchFiltersObj) {
    searchObject.bcc = emailSearchFiltersObj[EmailSearchFilters.BCC] as string;
  }
  if (EmailSearchFilters.CC in emailSearchFiltersObj) {
    searchObject.cc = emailSearchFiltersObj[EmailSearchFilters.CC] as string;
  }
  if (EmailSearchFilters.From in emailSearchFiltersObj) {
    searchObject.from = emailSearchFiltersObj[EmailSearchFilters.From] as string;
  }
  if (EmailSearchFilters.Subject in emailSearchFiltersObj) {
    searchObject.subject = emailSearchFiltersObj[EmailSearchFilters.Subject] as string;
  }
  if (EmailSearchFilters.Text in emailSearchFiltersObj) {
    searchObject.body = emailSearchFiltersObj[EmailSearchFilters.Text] as string;
  }
  if (EmailSearchFilters.To in emailSearchFiltersObj) {
    searchObject.to = emailSearchFiltersObj[EmailSearchFilters.To] as string;
  }
  if (EmailSearchFilters.UID in emailSearchFiltersObj) {
    searchObject.uid = emailSearchFiltersObj[EmailSearchFilters.UID] as string;
  }

  return searchObject;
}
