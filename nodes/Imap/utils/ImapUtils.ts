import { ImapFlow, ImapFlowOptions } from "imapflow";
import { ImapCredentialsData, STARTTLS_USAGE } from "../../../credentials/ImapCredentials.credentials";
import { INode, JsonValue, Logger as N8nLogger, NodeOperationError } from "n8n-workflow";


// interfaces for debug/info entries that ImapFlow logger provides
interface ImapLoggerEntryMessage {
  msg: string;
  cid?: string;
  src?: string;
  [key: string]: any;
};

// interface for error/warning entries that ImapFlow logger provides
interface ImapLoggerEntryError {
  err?: JsonValue;
  cid?: string;
  src?: string;
  [key: string]: any;
};

// a list of errors/warnings caught from ImapFlow while executing commands
export class ImapErrorsList {
  public caughtEntries: ImapLoggerEntryError[] = [];

  public addEntry(entry: ImapLoggerEntryError) {
    this.caughtEntries.push(entry);
  }

  public combineFullEntriesToString(): string {
    return JSON.stringify(this.caughtEntries, null, 2);
  }

  public toString(): string {
    if (this.caughtEntries.length === 0) {
      return "No additional details were provided by the IMAP server.";
    } else {
      return "The following errors were reported by the IMAP server: \n" + this.combineFullEntriesToString();
    }
  }

}


/* An error class that represents an error from the IMAP server
* It extends NodeOperationError and adds a description with the list of IMAP errors
* that were caught while executing the command that caused the error.
*/
export class NodeImapError extends NodeOperationError {
  constructor(node: INode, message: string, imapErrorsList: ImapErrorsList) {
    super(node, message, {
      description: imapErrorsList.toString(),
    });
  }
}

/**
 * A singleton class that catches all errors/warning from ImapFlow and provides a list of them on demand
 * 
 * @description This is needed because ImapFlow does not provide error details in thrown exceptions,
 * but only logs them internally while executing commands. So we need to catch them and provide them in case of an error.
 * Before executing any command that might fail, call `startErrorCatching()`, and if an exception is thrown, 
 * call `stopAndGetErrors()` to get the list of errors that happened during the command execution.
 * 
 */
export class ImapFlowErrorCatcher {
  private static instance: ImapFlowErrorCatcher;  
  private errorsList: ImapErrorsList = new ImapErrorsList();

  private isCatching = false;

  private constructor() {
    // private constructor
  }

  public static getInstance(): ImapFlowErrorCatcher {
    if (!ImapFlowErrorCatcher.instance) {
      ImapFlowErrorCatcher.instance = new ImapFlowErrorCatcher();
    }

    return ImapFlowErrorCatcher.instance;
  }

  private clear() {    
    this.errorsList = new ImapErrorsList();
  }

  public startErrorCatching() {
    // clear previous errors (assume that if we are catching errors, we don't need previous ones)
    this.clear();
    this.isCatching = true;
  }

  public stopAndGetErrorsList(): ImapErrorsList {
    this.isCatching = false;
    const ret_list = this.errorsList;
    this.clear();
    return ret_list;
  }

  public onImapError(error: object) {
    if (!this.isCatching) {
      return;
    }
    this.errorsList.addEntry(error as ImapLoggerEntryError);
  }

  public onImapWarning(warning: object) {
    if (!this.isCatching) {
      return;
    }
    this.errorsList.addEntry(warning as ImapLoggerEntryError);
  }

}

/* Converts ImapFlow logger entries to n8n logger entries and logs them
* Only logs info/debug entries if enableDebugLogs is true
*/
export class ImapLoggerToN8nConverter {
  private n8nLogger?: N8nLogger;
  private enableDebugLogs: boolean;
  constructor(enableDebugLogs: boolean, n8nLogger?: N8nLogger) {
    this.n8nLogger = n8nLogger;
    this.enableDebugLogs = enableDebugLogs;
  }

  public info(obj: object) {
    if (this.enableDebugLogs) {
      const entry = obj as ImapLoggerEntryMessage;
      if (!this.n8nLogger) {
        return;
      }
      this.n8nLogger.info(`IMAP info: ${entry.msg}`);
    }
  }

  public debug(obj: object) {
    if (this.enableDebugLogs) {
      const entry = obj as ImapLoggerEntryMessage;
      if (!this.n8nLogger) {
        return;
      }
      this.n8nLogger.debug(`IMAP debug: ${entry.msg}`);
    }
  }

  public error(obj: object) {
    const entry = obj as ImapLoggerEntryError;
    ImapFlowErrorCatcher.getInstance().onImapError(entry);
    if (!this.n8nLogger) {
      return;
    }
    // todo: check if entry has "err" key and other useful info
    this.n8nLogger.error(`IMAP error: ${JSON.stringify(entry)}`);
  }

  public warn(obj: object) {
    const entry = obj as ImapLoggerEntryError;
    ImapFlowErrorCatcher.getInstance().onImapWarning(entry);
    if (!this.n8nLogger) {
      return;
    }
    this.n8nLogger.warn(`IMAP warning: ${JSON.stringify(entry)}`);
  }
  
}


/**
 * Result of searching for emails by Message-ID
 */
export interface MessageIdSearchResult {
  /** The original Message-ID pattern that was searched */
  messageIdPattern: string;
  /** Whether any emails were found */
  found: boolean;
  /** List of UIDs found for this Message-ID pattern */
  uids: string[];
}

/**
 * Search for emails by Message-ID header (supports partial matching)
 * 
 * @param client - ImapFlow client (must have mailbox already opened)
 * @param messageIdPatterns - Array of Message-ID patterns to search for (without angle brackets)
 * @param logger - Optional logger for debug output
 * @returns Array of search results, one for each input pattern
 * 
 * @example
 * // Search for emails with Message-ID containing "@eshop.fyzioklinika.cz"
 * const results = await findEmailsByMessageId(client, ["@eshop.fyzioklinika.cz"], logger);
 * // results[0].uids will contain all matching email UIDs
 */
export async function findEmailsByMessageId(
  client: ImapFlow,
  messageIdPatterns: string[],
  logger?: N8nLogger
): Promise<MessageIdSearchResult[]> {
  const results: MessageIdSearchResult[] = [];

  for (const pattern of messageIdPatterns) {
    const trimmedPattern = pattern.trim();
    if (!trimmedPattern) {
      results.push({
        messageIdPattern: pattern,
        found: false,
        uids: [],
      });
      continue;
    }

    logger?.debug(`Searching for emails with Message-ID containing: "${trimmedPattern}"`);

    try {
      // Use IMAP SEARCH with HEADER command to find emails by Message-ID
      // This searches for Message-ID header containing the given pattern
      const searchQuery = {
        header: ['Message-ID', trimmedPattern],
      };

      const foundUids: string[] = [];
      
      // Search for matching emails
      for await (const msg of client.fetch(searchQuery, { uid: true })) {
        foundUids.push(msg.uid.toString());
      }

      logger?.debug(`Found ${foundUids.length} email(s) matching Message-ID pattern "${trimmedPattern}"`);

      results.push({
        messageIdPattern: trimmedPattern,
        found: foundUids.length > 0,
        uids: foundUids,
      });
    } catch (error) {
      logger?.warn(`Error searching for Message-ID "${trimmedPattern}": ${error}`);
      results.push({
        messageIdPattern: trimmedPattern,
        found: false,
        uids: [],
      });
    }
  }

  return results;
}

/**
 * Resolve email UIDs from either direct UID input or Message-ID search
 * 
 * @param client - ImapFlow client (must have mailbox already opened)
 * @param emailUid - Comma-separated UIDs (can be empty)
 * @param messageId - Comma-separated Message-ID patterns (can be empty)
 * @param logger - Optional logger
 * @returns Object with resolved UIDs and any not-found Message-IDs
 */
export async function resolveEmailUids(
  client: ImapFlow,
  emailUid: string,
  messageId: string,
  logger?: N8nLogger
): Promise<{
  uids: string[];
  notFoundMessageIds: string[];
  usedMessageId: boolean;
}> {
  const uids: string[] = [];
  const notFoundMessageIds: string[] = [];
  let usedMessageId = false;

  // First, add any directly specified UIDs
  if (emailUid && emailUid.trim()) {
    const directUids = emailUid.split(',').map(u => u.trim()).filter(u => u);
    uids.push(...directUids);
  }

  // Then, resolve any Message-ID patterns to UIDs
  if (messageId && messageId.trim()) {
    usedMessageId = true;
    const patterns = messageId.split(',').map(p => p.trim()).filter(p => p);
    
    if (patterns.length > 0) {
      const searchResults = await findEmailsByMessageId(client, patterns, logger);
      
      for (const result of searchResults) {
        if (result.found) {
          uids.push(...result.uids);
        } else {
          notFoundMessageIds.push(result.messageIdPattern);
        }
      }
    }
  }

  // Remove duplicate UIDs
  const uniqueUids = [...new Set(uids)];

  return {
    uids: uniqueUids,
    notFoundMessageIds,
    usedMessageId,
  };
}

export function createImapClient(credentials: ImapCredentialsData, logger?: N8nLogger, enableDebugLogs: boolean = false): ImapFlow {
  const loggerConverter = new ImapLoggerToN8nConverter(enableDebugLogs, logger);

  let imapflowOptions: ImapFlowOptions = {
    host: credentials.host as string,
    port: credentials.port as number,
    secure: credentials.tls as boolean,
    tls: {
      rejectUnauthorized: !credentials.allowUnauthorizedCerts as boolean,
    },
    auth: {
      user: credentials.user as string,
      pass: credentials.password as string,
    },
    logger: loggerConverter,
  };

  if (!credentials.tls) {
    if (credentials.startTLSUsage === STARTTLS_USAGE.IF_SUPPORTED) {
      // don't set doSTARTTLS, ImapFlow will use it if the server supports it
    } else {
      const doSTARTTLS : boolean = credentials.startTLSUsage === STARTTLS_USAGE.ALWAYS;
      imapflowOptions = {
        ...imapflowOptions,
        doSTARTTLS: doSTARTTLS,
      };
    };
  }

  const client = new ImapFlow(imapflowOptions);
  return client;
}

