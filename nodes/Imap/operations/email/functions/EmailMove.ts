import { ImapFlow } from "imapflow";
import { IExecuteFunctions, INodeExecutionData, Logger as N8nLogger } from "n8n-workflow";
import { IResourceOperationDef } from "../../../utils/CommonDefinitions";
import { getMailboxPathFromNodeParameter, parameterSelectMailbox } from '../../../utils/SearchFieldParameters';
import { ImapFlowErrorCatcher, NodeImapError, resolveEmailUids } from "../../../utils/ImapUtils";
import { ImapFlags } from "./EmailSetFlags";



const PARAM_NAME_SOURCE_MAILBOX = 'sourceMailbox';
const PARAM_NAME_DESTINATION_MAILBOX = 'destinationMailbox';

export const moveEmailOperation: IResourceOperationDef = {
  operation: {
    name: 'Move',
    value: 'moveEmail',
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
      description: 'UID of the email to move',
      hint: 'You can use comma separated list of UIDs to move multiple emails at once',
    },
    {
      displayName: 'Email Message-ID (Optional)',
      name: 'messageId',
      type: 'string',
      default: '',
      description: 'Message-ID from email header to identify the email (alternative to UID)',
      hint: 'You can use comma separated list of Message-IDs to move multiple emails at once. Supports partial matching (e.g. @example.com)',
    },
    {
      ...parameterSelectMailbox,
      displayName: 'Destination Mailbox',
      description: 'Select the destination mailbox',
      name: PARAM_NAME_DESTINATION_MAILBOX,
    },
    {
      displayName: 'Mark As Seen After Move',
      name: 'markAsSeen',
      type: 'boolean',
      default: false,
      description: 'Whether to mark the email as seen (read) after moving to the destination mailbox. If disabled, the email keeps its original read/unread status.',
    },
  ],
  async executeImapAction(context: IExecuteFunctions, logger: N8nLogger, itemIndex: number, client: ImapFlow): Promise<INodeExecutionData[] | null> {
    var returnData: INodeExecutionData[] = [];

    const sourceMailboxPath = getMailboxPathFromNodeParameter(context, itemIndex, PARAM_NAME_SOURCE_MAILBOX);
    const destinationMailboxPath = getMailboxPathFromNodeParameter(context, itemIndex, PARAM_NAME_DESTINATION_MAILBOX);

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
        // Neither UID nor Message-ID provided, or all Message-IDs not found
        returnData.push({
          json: {
            messageIdFound: false,
            messageId: messageId || '',
            message: 'No emails found to move',
          },
        });
      }
      return returnData;
    }

    const uidList = resolved.uids.join(',');
    logger.info(`Moving email(s) "${uidList}" from "${sourceMailboxPath}" to "${destinationMailboxPath}"`);

    ImapFlowErrorCatcher.getInstance().startErrorCatching();

    const resp = await client.messageMove(uidList, destinationMailboxPath, {
      uid: true,
    });

    if (!resp) {
      const errorsList = ImapFlowErrorCatcher.getInstance().stopAndGetErrorsList();
      throw new NodeImapError(
        context.getNode(),
        "Unable to move email",
        errorsList
      );
    }

    // If markAsSeen is enabled, set the \Seen flag on the moved email in destination mailbox
    const markAsSeen = context.getNodeParameter('markAsSeen', itemIndex, false) as boolean;
    if (markAsSeen && resp.uidMap) {
      // resp.uidMap contains mapping of source UIDs to destination UIDs
      // Get the new UIDs from the destination mailbox
      const newUids = Array.from(resp.uidMap.values()).join(',');
      if (newUids) {
        logger.info(`Marking email(s) as seen in destination mailbox. New UIDs: ${newUids}`);

        // Open destination mailbox and set Seen flag
        await client.mailboxOpen(destinationMailboxPath, { readOnly: false });
        const flagResult = await client.messageFlagsAdd(newUids, [ImapFlags.Seen], { uid: true });
        if (!flagResult) {
          logger.warn('Failed to set Seen flag on moved email(s)');
        }
      }
    }

    var item_json = JSON.parse(JSON.stringify(resp));
    item_json.markedAsSeen = markAsSeen;

    returnData.push({
      json: item_json,
    });

    return returnData;
  },
};
