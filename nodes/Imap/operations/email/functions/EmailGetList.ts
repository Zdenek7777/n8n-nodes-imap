import { FetchMessageObject, FetchQueryObject, ImapFlow } from "imapflow";
import { Readable } from "stream";
import { IDataObject, IExecuteFunctions, INodeExecutionData, Logger as N8nLogger } from "n8n-workflow";
import { IResourceOperationDef } from "../../../utils/CommonDefinitions";
import { getMailboxPathFromNodeParameter, parameterSelectMailbox } from "../../../utils/SearchFieldParameters";
import { emailSearchParameters, getEmailSearchParametersWithClientFilters } from "../../../utils/EmailSearchParameters";
import { simpleParser } from 'mailparser';
import { EmailPartInfo, getEmailPartsInfoRecursive } from "../../../utils/EmailParts";
import { parseEmailDate, convertToCRTimezone } from "../../../utils/dateParser";


export enum EmailParts {
  BodyStructure = 'bodyStructure',
  Flags = 'flags',
  Size = 'size',
  AttachmentsInfo = 'attachmentsInfo',
  TextContent = 'textContent',
  HtmlContent = 'htmlContent',
  Headers = 'headers',
}

function streamToString(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: any[] = [];
    stream.on('data', (chunk) => {
      chunks.push(chunk);
    });
    stream.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    stream.on('error', reject);
  });
}


export const getEmailsListOperation: IResourceOperationDef = {
  operation: {
    name: 'Get Many',
    value: 'getEmailsList',
  },
  parameters: [
    {
      ...parameterSelectMailbox,
      description: 'Select the mailbox',
    },
    ...emailSearchParameters,
    //
    {
      displayName: 'Include Message Parts',
      name: 'includeParts',
      type: 'multiOptions',
      placeholder: 'Add Part',
      default: [],
      options: [
        {
          name: 'Text Content',
          value: EmailParts.TextContent,
        },
        {
          name: 'HTML Content',
          value: EmailParts.HtmlContent,
        },
        {
          name: 'Attachments Info',
          value: EmailParts.AttachmentsInfo,
        },
        {
          name: 'Flags',
          value: EmailParts.Flags,
        },
        {
          name: 'Size',
          value: EmailParts.Size,
        },
        {
          name: 'Body Structure',
          value: EmailParts.BodyStructure,
        },
        {
          name: 'Headers',
          value: EmailParts.Headers,
        },
      ],
    },
    {
      displayName: 'Include All Headers',
      name: 'includeAllHeaders',
      type: 'boolean',
      default: true,
      description: 'Whether to include all headers in the output',
      displayOptions: {
        show: {
          includeParts: [
            EmailParts.Headers,
          ],
        },
      },
    },
    {
      displayName: 'Headers to Include',
      name: 'headersToInclude',
      type: 'string',
      default: '',
      description: 'Comma-separated list of headers to include',
      placeholder: 'received,authentication-results,return-path',
      displayOptions: {
        show: {
          includeParts: [
            EmailParts.Headers,
          ],
          includeAllHeaders: [
            false,
          ],
        },
      },
    }
  ],
  async executeImapAction(context: IExecuteFunctions, logger: N8nLogger, itemIndex: number, client: ImapFlow): Promise<INodeExecutionData[] | null> {
    var returnData: INodeExecutionData[] = [];

    const mailboxPath = getMailboxPathFromNodeParameter(context, itemIndex);

    logger.info(`Getting emails list from ${mailboxPath}`);

    await client.mailboxOpen(mailboxPath);

    // Get search parameters with client-side filter support for non-ASCII text
    // For Seznam.cz and similar: sends ASCII version to IMAP, keeps original for client-side filtering
    const searchParams = getEmailSearchParametersWithClientFilters(context, itemIndex);
    const searchObject = searchParams.searchObject;
    const clientSideFilters = searchParams.clientSideFilters;

    if (searchParams.needsClientSideFiltering) {
      logger.info(`Non-ASCII characters detected in search filters, will apply client-side filtering after IMAP fetch`);
      if (clientSideFilters.subject) {
        logger.info(`  Subject filter: "${clientSideFilters.subject}" (IMAP will search for ASCII version)`);
      }
    }

    // Log date range parameters for debugging
    const emailDateRangeObj = context.getNodeParameter('emailDateRange', itemIndex) as IDataObject;
    const sinceInput = emailDateRangeObj['since'] as string;
    const beforeInput = emailDateRangeObj['before'] as string;

    if (sinceInput || beforeInput) {
      logger.info(`Date range input - Since: ${sinceInput || 'not set'}, Before: ${beforeInput || 'not set'}`);

      // Check if time components are specified (IMAP only works with dates, not times)
      if (sinceInput) {
        const sinceDate = new Date(sinceInput);
        const hasTimeComponent = sinceDate.getHours() !== 0 || sinceDate.getMinutes() !== 0 || sinceDate.getSeconds() !== 0;
        if (hasTimeComponent) {
          logger.warn(`IMAP protocol limitation: 'Since' date has time component (${sinceInput}), but IMAP SEARCH only works with dates, not times. The search will include all emails from the entire day.`);
        }
      }
      if (beforeInput) {
        const beforeDate = new Date(beforeInput);
        const hasTimeComponent = beforeDate.getHours() !== 0 || beforeDate.getMinutes() !== 0 || beforeDate.getSeconds() !== 0;
        if (hasTimeComponent) {
          logger.warn(`IMAP protocol limitation: 'Before' date has time component (${beforeInput}), but IMAP SEARCH only works with dates, not times. The search will include all emails from the entire day.`);
        }
      }

      // Log what will actually be sent to IMAP server
      if (searchObject.since) {
        const sinceDate = searchObject.since as Date;
        logger.info(`IMAP SEARCH will use SINCE: ${sinceDate.toISOString().split('T')[0]} (date only, time ignored)`);
      }
      if (searchObject.before) {
        const beforeDate = searchObject.before as Date;
        logger.info(`IMAP SEARCH will use BEFORE: ${beforeDate.toISOString().split('T')[0]} (date only, time ignored)`);
      }
    }

    const includeParts = context.getNodeParameter('includeParts', itemIndex) as string[];
    var fetchQuery: FetchQueryObject = {
      uid: true,
      envelope: true,
      // Note: internalDate is automatically included in FetchMessageObject by imapflow
      // It represents when email actually arrived on server (INTERNALDATE)
      // This is more accurate than Date header, especially for forwarded emails
    };

    if (includeParts.includes(EmailParts.BodyStructure)) {
      fetchQuery.bodyStructure = true;
    }
    if (includeParts.includes(EmailParts.Flags)) {
      fetchQuery.flags = true;
    }
    if (includeParts.includes(EmailParts.Size)) {
      fetchQuery.size = true;
    }
    // Always fetch Date header to ensure we can extract date even if envelope.date is missing
    if (includeParts.includes(EmailParts.Headers)) {
      // check if user wants only specific headers
      const includeAllHeaders = context.getNodeParameter('includeAllHeaders', itemIndex) as boolean;
      if (includeAllHeaders) {
        fetchQuery.headers = true;
      } else {
        const headersToInclude = context.getNodeParameter('headersToInclude', itemIndex) as string;
        logger.info(`Including headers: ${headersToInclude}`);
        if (headersToInclude) {
          const headersList = headersToInclude.split(',').map((header) => header.trim());
          // Ensure Date header is included
          if (!headersList.includes('Date') && !headersList.includes('date')) {
            headersList.push('Date');
          }
          fetchQuery.headers = headersList;
          logger.info(`Including headers: ${fetchQuery.headers}`);
        } else {
          // If no specific headers, at least fetch Date header
          fetchQuery.headers = ['Date'];
        }
      }
    } else {
      // Even if headers are not requested, fetch Date header for date extraction
      fetchQuery.headers = ['Date'];
    }

    // will parse the bodystructure to get the attachments info
    const includeAttachmentsInfo = includeParts.includes(EmailParts.AttachmentsInfo);
    if (includeAttachmentsInfo) {
      fetchQuery.bodyStructure = true;
    }
    // text Content and html Content
    const includeTextContent = includeParts.includes(EmailParts.TextContent);
    const includeHtmlContent = includeParts.includes(EmailParts.HtmlContent);
    if (includeTextContent || includeHtmlContent) {
      // will parse the bodystructure to get the parts IDs for text and html
      fetchQuery.bodyStructure = true;
    }

    // log searchObject and fetchQuery
    logger.debug(`Search object: ${JSON.stringify(searchObject)}`);
    logger.debug(`Fetch query: ${JSON.stringify(fetchQuery)}`);

    // wait for all emails to be fetched before processing them
    // because we might need to fetch the body parts for each email,
    // and this will freeze the client if we do it in parallel
    const emailsList: FetchMessageObject[] = [];
    for await (let email of client.fetch(searchObject, fetchQuery)) {
      emailsList.push(email);
    }
    logger.info(`Found ${emailsList.length} emails from IMAP server`);

    // Client-side filtering by time if time components were specified
    // (IMAP protocol only supports date-based search, not time-based)
    let filteredEmailsList: FetchMessageObject[] = emailsList;
    if (sinceInput || beforeInput) {
      const sinceDate = sinceInput ? new Date(sinceInput) : null;
      const beforeDate = beforeInput ? new Date(beforeInput) : null;

      // Check if time filtering is needed (if time components are specified)
      const needsTimeFiltering =
        (sinceDate && (sinceDate.getHours() !== 0 || sinceDate.getMinutes() !== 0 || sinceDate.getSeconds() !== 0)) ||
        (beforeDate && (beforeDate.getHours() !== 0 || beforeDate.getMinutes() !== 0 || beforeDate.getSeconds() !== 0));

      if (needsTimeFiltering) {
        logger.info(`Applying client-side time filtering (IMAP only supports date-based search)`);
        filteredEmailsList = emailsList.filter((email) => {
          // IMPORTANT: Use INTERNALDATE (actual delivery time) instead of Date header (original send time)
          // This fixes the issue where forwarded emails have Date header from original send time,
          // but were actually delivered later (e.g., due to greylisting, SMTP delays, etc.)
          // INTERNALDATE represents when the email actually arrived on the IMAP server
          let emailDate: Date | null = null;
          let dateSource = 'unknown';

          // Priority 1: Use internalDate (INTERNALDATE from IMAP server - actual delivery time)
          // This is the most accurate for filtering, as it represents when email actually arrived
          // Note: internalDate is automatically included in FetchMessageObject by imapflow
          const emailInternalDate = (email as any).internalDate;
          if (emailInternalDate) {
            emailDate = emailInternalDate instanceof Date
              ? emailInternalDate
              : new Date(emailInternalDate);
            dateSource = 'internalDate';
          }
          // Priority 2: Fallback to envelope.date (may still be Date header, but better than nothing)
          else if (email.envelope?.date) {
            emailDate = email.envelope.date instanceof Date ? email.envelope.date : new Date(email.envelope.date);
            dateSource = 'envelope.date';
            logger.debug(`    Email ${email.uid}: Using envelope.date as fallback (internalDate not available)`);
          }
          // Priority 3: Extract Date header as last resort
          else if (email.headers) {
            try {
              const headersString = email.headers.toString();
              const dateHeaderMatch = headersString.match(/^Date:\s*([^\r\n]+)/im);
              if (dateHeaderMatch && dateHeaderMatch[1]) {
                const parsedDate = parseEmailDate(dateHeaderMatch[1].trim());
                if (parsedDate) {
                  emailDate = new Date(parsedDate);
                  dateSource = 'Date header';
                  logger.debug(`    Email ${email.uid}: Using Date header as fallback (internalDate and envelope.date not available)`);
                }
              }
            } catch (error) {
              logger.debug(`    Email ${email.uid}: Could not extract date from headers for filtering: ${error}`);
            }
          }

          if (!emailDate || isNaN(emailDate.getTime())) {
            // If we can't determine the date, include the email (don't filter it out)
            logger.debug(`    Email ${email.uid}: Could not determine date, including in results`);
            return true;
          }

          // Check if email date is within the time range
          const isAfterSince = !sinceDate || emailDate >= sinceDate;
          const isBeforeBefore = !beforeDate || emailDate < beforeDate;

          const isInRange = isAfterSince && isBeforeBefore;

          if (!isInRange) {
            logger.debug(`    Email ${email.uid}: Filtered out (date: ${emailDate.toISOString()} [${dateSource}], since: ${sinceDate?.toISOString() || 'none'}, before: ${beforeDate?.toISOString() || 'none'})`);
          } else {
            logger.debug(`    Email ${email.uid}: Passed filter (date: ${emailDate.toISOString()} [${dateSource}])`);
          }

          return isInRange;
        });

        logger.info(`After time filtering: ${filteredEmailsList.length} emails (filtered out ${emailsList.length - filteredEmailsList.length} emails)`);
      }
    }

    // Client-side filtering for non-ASCII text (e.g., Czech diacritics)
    // This is needed because Seznam.cz IMAP doesn't support UTF-8 in SEARCH commands
    if (searchParams.needsClientSideFiltering) {
      const beforeClientFilter = filteredEmailsList.length;

      filteredEmailsList = filteredEmailsList.filter((email) => {
        // Check subject filter
        if (clientSideFilters.subject) {
          const emailSubject = email.envelope?.subject || '';
          // Case-insensitive contains check
          if (!emailSubject.toLowerCase().includes(clientSideFilters.subject.toLowerCase())) {
            logger.debug(`    Email ${email.uid}: Filtered out (subject "${emailSubject}" doesn't contain "${clientSideFilters.subject}")`);
            return false;
          }
        }

        // Check from filter
        if (clientSideFilters.from) {
          const fromAddresses = email.envelope?.from?.map((a: { address?: string; name?: string }) =>
            `${a.name || ''} ${a.address || ''}`).join(' ') || '';
          if (!fromAddresses.toLowerCase().includes(clientSideFilters.from.toLowerCase())) {
            return false;
          }
        }

        // Check to filter
        if (clientSideFilters.to) {
          const toAddresses = email.envelope?.to?.map((a: { address?: string; name?: string }) =>
            `${a.name || ''} ${a.address || ''}`).join(' ') || '';
          if (!toAddresses.toLowerCase().includes(clientSideFilters.to.toLowerCase())) {
            return false;
          }
        }

        return true;
      });

      logger.info(`After client-side text filtering: ${filteredEmailsList.length} emails (filtered out ${beforeClientFilter - filteredEmailsList.length} emails)`);
    }

    // process the emails
    for (const email of filteredEmailsList) {
      logger.info(`  ${email.uid}`);
      var item_json = JSON.parse(JSON.stringify(email));

      // add mailbox path to the item
      item_json.mailboxPath = mailboxPath;

      // ============================================
      // FIX: Extract and display date from email (always show date if available)
      // ============================================
      let originalDate: string | null = null;

      // First, try to get original date from headers (before JSON serialization converts it)
      // This preserves the exact format as received in the email
      if (email.headers) {
        try {
          const headersString = email.headers.toString();
          // Try to extract Date header manually - match "Date: " followed by the date value
          // Handle both single-line and multi-line headers
          const dateHeaderMatch = headersString.match(/^Date:\s*([^\r\n]+)/im);
          if (dateHeaderMatch && dateHeaderMatch[1]) {
            originalDate = dateHeaderMatch[1].trim();
            logger.info(`    Extracted date from headers: ${originalDate}`);
          }
        } catch (error) {
          logger.debug(`    Could not extract date from headers: ${error}`);
        }
      }

      // If not found in headers, try to get date from envelope
      // Note: After JSON.parse(JSON.stringify()), Date objects become ISO strings
      if ((!originalDate || !originalDate.trim()) && item_json.envelope?.date !== null && item_json.envelope?.date !== undefined) {
        // Convert to string if it's a Date object or already a string
        if (typeof item_json.envelope.date === 'string') {
          originalDate = item_json.envelope.date;
        } else if (item_json.envelope.date instanceof Date) {
          // This shouldn't happen after JSON serialization, but handle it anyway
          originalDate = item_json.envelope.date.toISOString();
        } else {
          // If it's something else, convert to string
          originalDate = String(item_json.envelope.date);
        }
      }

      // ALWAYS set date fields if we found a date (even if it's in non-standard format)
      if (originalDate && originalDate.trim()) {
        // Ensure envelope object exists
        if (!item_json.envelope) {
          item_json.envelope = {};
        }

        // Store original date exactly as received (before any parsing)
        const dateOriginal = originalDate;

        // Try to parse the date to ISO format
        const parsedDateISO = parseEmailDate(originalDate);

        // Convert parsed ISO date to CR timezone format
        let dateInCRTimezone: string | null = null;
        if (parsedDateISO && parsedDateISO.trim() && parsedDateISO !== originalDate) {
          dateInCRTimezone = convertToCRTimezone(parsedDateISO);
        }

        // Reconstruct envelope object with correct field order: date, dateOriginal, then other fields
        const envelopeDate = dateInCRTimezone || parsedDateISO || originalDate;
        const envelopeDateOriginal = dateOriginal;

        // Get all other envelope fields
        const { date: _, dateOriginal: __, ...otherEnvelopeFields } = item_json.envelope;

        // Rebuild envelope with correct order: date first, then dateOriginal, then other fields
        item_json.envelope = {
          date: envelopeDate,
          dateOriginal: envelopeDateOriginal,
          ...otherEnvelopeFields,
        };

        // Set top-level date field to CR timezone format (or parsed ISO if conversion failed)
        item_json.date = dateInCRTimezone || parsedDateISO || originalDate;
      }
      // ============================================

      // process the headers
      if (includeParts.includes(EmailParts.Headers)) {
        if (email.headers) {
          try {
            const headersString = email.headers.toString();
            const parsed = await simpleParser(headersString);
            item_json.headers = {};
            parsed.headers.forEach((value, key, map) => {
              //logger.info(`    HEADER [${key}] = ${value}`);
              item_json.headers[key] = value;
            });
          } catch (error) {
            logger.error(`    Error parsing headers: ${error}`);
          }
        }
      }


      const analyzeBodyStructure = includeAttachmentsInfo || includeTextContent || includeHtmlContent;

      var textPartId = null;
      var htmlPartId = null;
      var attachmentsInfo = [];


      if (analyzeBodyStructure) {
        // workaround: dispositionParameters is an object, but it is not typed as such
        const bodyStructure = email.bodyStructure as unknown as any;

        if (bodyStructure) {

          const partsInfo: EmailPartInfo[] = getEmailPartsInfoRecursive(context, bodyStructure);

          // filter attachments and text/html parts
          for (const partInfo of partsInfo) {
            if (partInfo.disposition === 'attachment') {
              // this is an attachment
              attachmentsInfo.push({
                partId: partInfo.partId,
                filename: partInfo.filename,
                type: partInfo.type,
                encoding: partInfo.encoding,
                size: partInfo.size,
              });
            } else {
              // if there is only one part, to sometimes it has no partId
              // in that case, ImapFlow uses "TEXT" as partId to download the only part
              if (partInfo.type === 'text/plain') {
                textPartId = partInfo.partId;
              }
              if (partInfo.type === 'text/html') {
                htmlPartId = partInfo.partId;
              }
            }
          }
        }
      }

      if (includeAttachmentsInfo) {
        item_json.attachmentsInfo = attachmentsInfo;
      }

      // fetch text and html content
      if (includeTextContent || includeHtmlContent) {
        if (includeTextContent) {
          // always set textContent to null, in case there is no text part
          item_json.textContent = null;
          if (textPartId) {
            const textContent = await client.download(email.uid.toString(), textPartId, {
              uid: true,
            });
            if (textContent.content) {
              item_json.textContent = await streamToString(textContent.content);
            }
          }
        }
        if (includeHtmlContent) {
          // always set htmlContent to null, in case there is no html part
          item_json.htmlContent = null;
          if (htmlPartId) {
            const htmlContent = await client.download(email.uid.toString(), htmlPartId, {
              uid: true,
            });
            if (htmlContent.content) {
              item_json.htmlContent = await streamToString(htmlContent.content);
            }
          }
        }
      }

      // Remove headers and buffer from output (they were added by developer but should not be in output)
      if (item_json.headers !== undefined) {
        delete item_json.headers;
      }
      if (item_json.buffer !== undefined) {
        delete item_json.buffer;
      }

      returnData.push({
        json: item_json,
      });
    }

    return returnData;
  },
};
