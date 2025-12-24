import { ImapFlow } from 'imapflow';
import { IExecuteFunctions, INodeExecutionData, Logger as N8nLogger } from 'n8n-workflow';
import { IResourceOperationDef } from '../../../utils/CommonDefinitions';
import {
  getMailboxPathFromNodeParameter,
  parameterSelectMailbox,
} from '../../../utils/SearchFieldParameters';
import { ImapFlowErrorCatcher, NodeImapError, resolveEmailUids } from '../../../utils/ImapUtils';

const PARAM_NAME_SOURCE_MAILBOX = 'sourceMailbox';
const PARAM_NAME_DESTINATION_MAILBOX = 'destinationMailbox';

export const copyEmailOperation: IResourceOperationDef = {
  operation: {
    name: 'Copy',
    value: 'copyEmail',
  },
  parameters: [
    {
      ...parameterSelectMailbox,
      displayName: 'Source Mailbox',
      description: 'Select the source mailbox',
      name: PARAM_NAME_SOURCE_MAILBOX,
    },
    {
      displayName: 'Email UID',
      name: 'emailUid',
      type: 'string',
      default: '',
      description: 'UID of the email to copy',
      hint: 'You can use comma separated list of UIDs to copy multiple emails at once',
    },
    {
      displayName: 'Email Message-ID (Optional)',
      name: 'messageId',
      type: 'string',
      default: '',
      description: 'Message-ID from email header to identify the email (alternative to UID)',
      hint: 'You can use comma separated list of Message-IDs to copy multiple emails at once. Supports partial matching (e.g. @example.com)',
    },
    {
      ...parameterSelectMailbox,
      displayName: 'Destination Mailbox',
      description: 'Select the destination mailbox',
      name: PARAM_NAME_DESTINATION_MAILBOX,
    },
  ],
  async executeImapAction(
    context: IExecuteFunctions,
    logger: N8nLogger,
    itemIndex: number,
    client: ImapFlow,
  ): Promise<INodeExecutionData[] | null> {
    var returnData: INodeExecutionData[] = [];

    const sourceMailboxPath = getMailboxPathFromNodeParameter(
      context,
      itemIndex,
      PARAM_NAME_SOURCE_MAILBOX,
    );
    const destinationMailboxPath = getMailboxPathFromNodeParameter(
      context,
      itemIndex,
      PARAM_NAME_DESTINATION_MAILBOX,
    );

    const emailUid = context.getNodeParameter('emailUid', itemIndex) as string;
    const messageId = context.getNodeParameter('messageId', itemIndex, '') as string;

    await client.mailboxOpen(sourceMailboxPath, { readOnly: false });

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
            message: 'No emails found to copy',
          },
        });
      }
      return returnData;
    }

    const uidList = resolved.uids.join(',');
    logger.info(
      `Copying email(s) "${uidList}" from "${sourceMailboxPath}" to "${destinationMailboxPath}"`,
    );

    ImapFlowErrorCatcher.getInstance().startErrorCatching();

    const resp = await client.messageCopy(uidList, destinationMailboxPath, {
      uid: true,
    });

    if (!resp) {
      const errors = ImapFlowErrorCatcher.getInstance().stopAndGetErrorsList();
      throw new NodeImapError(context.getNode(), 'Email copy operation failed', errors);
    }

    var item_json = JSON.parse(JSON.stringify(resp));

    returnData.push({
      json: item_json,
    });

    return returnData;
  },
};
