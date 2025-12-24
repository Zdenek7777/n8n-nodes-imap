import { ImapFlow } from 'imapflow';
import { IExecuteFunctions, INodeExecutionData, Logger as N8nLogger } from 'n8n-workflow';
import { IResourceOperationDef } from '../../../utils/CommonDefinitions';
import { getMailboxPathFromNodeParameter, parameterSelectMailbox } from '../../../utils/SearchFieldParameters';
import { ImapFlowErrorCatcher, NodeImapError, resolveEmailUids } from '../../../utils/ImapUtils';

export const deleteEmailOperation: IResourceOperationDef = {
  operation: {
    name: 'Delete',
    value: 'deleteEmail',
    description: 'Permanently delete one or more emails from a mailbox',
  },
  parameters: [
    {
      ...parameterSelectMailbox,
      description: 'Select the mailbox containing the email to delete',
    },
    {
      displayName: 'Email UID',
      name: 'emailUid',
      type: 'string',
      default: '',
      description: 'UID of the email to delete',
      hint: 'You can use a comma separated list of UIDs to delete multiple emails at once',
    },
    {
      displayName: 'Email Message-ID (Optional)',
      name: 'messageId',
      type: 'string',
      default: '',
      description: 'Message-ID from email header to identify the email (alternative to UID)',
      hint: 'You can use comma separated list of Message-IDs to delete multiple emails at once. Supports partial matching (e.g. @example.com)',
    },
  ],
  async executeImapAction(
    context: IExecuteFunctions,
    logger: N8nLogger,
    itemIndex: number,
    client: ImapFlow,
  ): Promise<INodeExecutionData[] | null> {
    const returnData: INodeExecutionData[] = [];

    const mailboxPath = getMailboxPathFromNodeParameter(context, itemIndex);
    const emailUid = context.getNodeParameter('emailUid', itemIndex) as string;
    const messageId = context.getNodeParameter('messageId', itemIndex, '') as string;

    await client.mailboxOpen(mailboxPath, { readOnly: false });

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
            message: 'No emails found to delete',
          },
        });
      }
      return returnData;
    }

    const uidList = resolved.uids.join(',');
    logger.info(`Deleting email(s) "${uidList}" from "${mailboxPath}"`);

    ImapFlowErrorCatcher.getInstance().startErrorCatching();
    const isDeleted = await client.messageDelete(uidList, {
      uid: true,
    });

    if (!isDeleted) {
      const errorsList = ImapFlowErrorCatcher.getInstance().stopAndGetErrorsList();
      throw new NodeImapError(context.getNode(), 'Unable to delete email', errorsList);
    }

    returnData.push({
      json: {
        uid: uidList,
        deleted: true,
      },
    });

    return returnData;
  },
};
