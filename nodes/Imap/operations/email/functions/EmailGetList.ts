import { FetchMessageObject, FetchQueryObject, ImapFlow } from "imapflow";
import { Readable } from "stream";
import { IExecuteFunctions, INodeExecutionData, Logger as N8nLogger } from "n8n-workflow";
import { IResourceOperationDef } from "../../../utils/CommonDefinitions";
import { getMailboxPathFromNodeParameter, parameterSelectMailbox } from "../../../utils/SearchFieldParameters";
import { emailSearchParameters, getEmailSearchParametersFromNode } from "../../../utils/EmailSearchParameters";
import { simpleParser } from 'mailparser';
import { EmailPartInfo, getEmailPartsInfoRecursive } from "../../../utils/EmailParts";
import { parseEmailDate } from "../../../utils/dateParser";


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

    var searchObject = getEmailSearchParametersFromNode(context, itemIndex);

    const includeParts = context.getNodeParameter('includeParts', itemIndex) as string[];
    var fetchQuery : FetchQueryObject = {
      uid: true,
      envelope: true,
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
    if (includeParts.includes(EmailParts.Headers)) {      
      // check if user wants only specific headers
      const includeAllHeaders = context.getNodeParameter('includeAllHeaders', itemIndex) as boolean;
      if (includeAllHeaders) {
        fetchQuery.headers = true;
      } else {
        const headersToInclude = context.getNodeParameter('headersToInclude', itemIndex) as string;
        logger.info(`Including headers: ${headersToInclude}`);
        if (headersToInclude) {
          fetchQuery.headers = headersToInclude.split(',').map((header) => header.trim());
          logger.info(`Including headers: ${fetchQuery.headers}`);
        }
      }
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
    for  await (let email of client.fetch(searchObject, fetchQuery)) {
      emailsList.push(email);
    }
    logger.info(`Found ${emailsList.length} emails`);

    // process the emails
    for (const email of emailsList) {
      logger.info(`  ${email.uid}`);
      var item_json = JSON.parse(JSON.stringify(email));

      // add mailbox path to the item
      item_json.mailboxPath = mailboxPath;

      // ============================================
      // FIX: Parse non-standard date formats
      // ============================================
      let originalDate: string | null = null;
      
      // First, try to get date from envelope
      if (item_json.envelope?.date !== null && item_json.envelope?.date !== undefined) {
        // Convert to string if it's a Date object or already a string
        // Note: After JSON.parse(JSON.stringify()), Date objects become ISO strings
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
      
      // If envelope.date is not available, try to get date from headers
      if ((!originalDate || !originalDate.trim()) && email.headers) {
        try {
          const headersString = email.headers.toString();
          // Try to extract Date header manually
          const dateHeaderMatch = headersString.match(/^Date:\s*(.+)$/im);
          if (dateHeaderMatch && dateHeaderMatch[1]) {
            originalDate = dateHeaderMatch[1].trim();
            logger.info(`    Extracted date from headers: ${originalDate}`);
          }
        } catch (error) {
          logger.debug(`    Could not extract date from headers: ${error}`);
        }
      }
      
      // Process date if we have one
      if (originalDate && originalDate.trim()) {
        // Keep original date string for reference BEFORE parsing
        if (item_json.envelope) {
          item_json.envelope.dateOriginal = originalDate;
        } else {
          item_json.envelope = { dateOriginal: originalDate };
        }
        
        // Parse the date string (handles non-standard formats)
        // This will return ISO string for both standard and non-standard formats
        const parsedDate = parseEmailDate(originalDate);
        
        // Always set envelope.date to parsed date (or original if parsing failed)
        if (parsedDate && parsedDate.trim()) {
          if (!item_json.envelope) {
            item_json.envelope = {};
          }
          item_json.envelope.date = parsedDate;
        } else if (!item_json.envelope) {
          item_json.envelope = { date: originalDate };
        }
        
        // ALWAYS add a convenience field at the top level
        // Use parsed date if available, otherwise use original
        item_json.date = (parsedDate && parsedDate.trim()) ? parsedDate : originalDate;
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

      returnData.push({
        json: item_json,
      });
    }

    return returnData;
  },
};
