import { DownloadObject, FetchQueryObject, ImapFlow } from "imapflow";
import { IExecuteFunctions, INodeExecutionData, Logger as N8nLogger } from "n8n-workflow";
import { IResourceOperationDef } from "../../../utils/CommonDefinitions";
import { getMailboxPathFromNodeParameter, parameterSelectMailbox } from "../../../utils/SearchFieldParameters";
import { ImapFlowErrorCatcher, NodeImapError, resolveEmailUids } from "../../../utils/ImapUtils";
import { getEmailPartsInfoRecursive } from "../../../utils/EmailParts";

export const downloadAttachmentOperation: IResourceOperationDef = {
  operation: {
    name: 'Download Attachment',
    value: 'downloadAttachment',
  },
  parameters: [
    {
      ...parameterSelectMailbox,
      description: 'Select the mailbox',
    },
    {
      displayName: 'Email UID',
      name: 'emailUid',
      type: 'string',
      default: '',
      description: 'UID of the email to download',
    },
    {
      displayName: 'Email Message-ID (Optional)',
      name: 'messageId',
      type: 'string',
      default: '',
      description: 'Message-ID from email header to identify the email (alternative to UID)',
      hint: 'You can use comma separated list of Message-IDs to download attachments from multiple emails at once. Supports partial matching (e.g. @example.com)',
    },
    {
      displayName: 'All Attachments',
      name: 'allAttachments',
      type: 'boolean',
      default: false,
      description: 'Whether to download all attachments',
    },
    {
      displayName: 'Attachment Part IDs',
      name: 'partId',
      type: 'string',
      default: '',
      required: true,
      description: 'Comma-separated list of attachment part IDs to download',
      hint: 'Part IDs can be found in the email "attachmentsInfo" property',
      displayOptions: {
        show: {
          allAttachments: [
            false,
          ],
        },
      },
    },
    {
      displayName: 'Include Inline Attachments',
      name: 'includeInlineAttachments',
      type: 'boolean',
      default: false,
      description: 'Whether to include inline attachments (e.g. images embedded in HTML)',
      displayOptions: {
        show: {
          allAttachments: [
            true,
          ],
        },
      },
    }
  ],
  async executeImapAction(context: IExecuteFunctions, logger: N8nLogger, itemIndex: number, client: ImapFlow): Promise<INodeExecutionData[] | null> {
    const returnData: INodeExecutionData[] = [];

    const mailboxPath = getMailboxPathFromNodeParameter(context, itemIndex);

    await client.mailboxOpen(mailboxPath, { readOnly: true });

    const emailUid = context.getNodeParameter('emailUid', itemIndex) as string;
    const messageId = context.getNodeParameter('messageId', itemIndex, '') as string;
    const allAttachments = context.getNodeParameter('allAttachments', itemIndex) as boolean;

    // Resolve UIDs from both direct UID and Message-ID inputs
    const resolved = await resolveEmailUids(client, emailUid, messageId, logger);

    // If Message-ID was used but some were not found, return info about not found
    if (resolved.usedMessageId && resolved.notFoundMessageIds.length > 0) {
      for (const notFoundId of resolved.notFoundMessageIds) {
        returnData.push({
          json: {
            messageIdFound: false,
            messageId: notFoundId,
            message: 'Email with specified Message-ID not found',
          },
        });
      }
    }

    // If no UIDs to process, return early
    if (resolved.uids.length === 0) {
      if (returnData.length === 0) {
        returnData.push({
          json: {
            messageIdFound: false,
            messageId: messageId || '',
            message: 'No emails found to download attachments from',
          },
        });
      }
      return returnData;
    }

    // Process each email
    for (const uid of resolved.uids) {
      var returnItem: INodeExecutionData = {
        json: {},
        binary: {},
      };
      var jsonAttachments: any[] = [];
      var attachmentCounter = 0;

      let partsToDownload: string[] = [];

      if (allAttachments) {
        const includeInlineAttachments = context.getNodeParameter('includeInlineAttachments', itemIndex) as boolean;

        // get attachments info from the email
        const query: FetchQueryObject = {
          uid: true,
          bodyStructure: true,
        };
        const emailInfo = await client.fetchOne(uid, query, { uid: true });
        
        if (!emailInfo) {
          const errors = ImapFlowErrorCatcher.getInstance().stopAndGetErrorsList();
          throw new NodeImapError(context.getNode(), `Failed to fetch email UID ${uid}`, errors);
        }
        
        if (emailInfo.bodyStructure) {
          const partsInfo = getEmailPartsInfoRecursive(context, emailInfo.bodyStructure);
          for (const partInfo of partsInfo) {
            logger.debug(`Attachment part info: ${JSON.stringify(partInfo)}`);
            if (partInfo.disposition === 'attachment') {
              // regular attachment
              partsToDownload.push(partInfo.partId);
            } else if (partInfo.disposition === 'inline' && includeInlineAttachments) {
              // inline attachment
              partsToDownload.push(partInfo.partId);
            }
          }
        } else{
          logger.warn(`IMAP server has not returned email body structure for email "${uid}"`);
        }
        if (partsToDownload.length > 0) {
          logger.info(`Downloading all attachments from email "${uid}": ${partsToDownload.join(', ')}`);
        } else {
          logger.warn(`Email "${uid}" does not have any attachments`);
        }
      } else {
        const partId = context.getNodeParameter('partId', itemIndex) as string;
        // split by comma and remove spaces
        const parts = partId.split(',').map((part) => part.trim());
        partsToDownload.push(...parts);
        logger.info(`Downloading some attachments from email "${uid}": ${partsToDownload.join(', ')}`);
      }

      for (const partId of partsToDownload) {

        logger.info(`Downloading attachment "${partId}" from email "${uid}"`);


        // start catching errors
        ImapFlowErrorCatcher.getInstance().startErrorCatching();

        const resp : DownloadObject = await client.download(uid, partId, {
          uid: true,
        });

        if (!resp.meta) {
          // get IMAP errors
          const errorsList = ImapFlowErrorCatcher.getInstance().stopAndGetErrorsList();

          throw new NodeImapError(
            context.getNode(),
            `Unable to download attachment partId "${partId}" of email "${uid}"`,
            errorsList,
          );
        }

        const binaryData = await context.helpers.prepareBinaryData(resp.content, resp.meta.filename, resp.meta.contentType);
        logger.info(`Attachment downloaded: ${binaryData.data.length} bytes`);

        const fieldName = `attachment_${attachmentCounter}`;
        attachmentCounter++;

        const jsonAttachmentInfo = {
          partId: partId,
          binaryFieldName: fieldName,
          ...resp.meta,
        };
        jsonAttachments.push(jsonAttachmentInfo);

        returnItem.binary![fieldName] = binaryData;
      }

      // add attachments info and uid to the return item
      returnItem.json!.uid = uid;
      returnItem.json!.attachments = jsonAttachments;
      returnData.push(returnItem);
    }

    return returnData;
  },
};
