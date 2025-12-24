import { ImapFlow } from "imapflow";
import { IDataObject, IExecuteFunctions, INodeExecutionData, Logger as N8nLogger } from "n8n-workflow";
import { IResourceOperationDef } from "../../../utils/CommonDefinitions";
import { getMailboxPathFromNodeParameter, parameterSelectMailbox } from '../../../utils/SearchFieldParameters';
import { ImapFlowErrorCatcher, NodeImapError, resolveEmailUids } from "../../../utils/ImapUtils";


export enum ImapFlags {
  Answered = '\\Answered',
  Flagged = '\\Flagged',
  Deleted = '\\Deleted',
  Seen = '\\Seen',
  Draft = '\\Draft',
}

const KEY_SET_CUSTOM_FLAGS = 'setFlags';
const KEY_REMOVE_CUSTOM_FLAGS = 'removeFlags';

function splitSpaceSeparatedString(input: string): string[] {
  return input.trim().split(/\s+/).filter(f => f !== '');
}

export const setEmailFlagsOperation: IResourceOperationDef = {
  operation: {
    name: 'Set Flags',
    value: 'setEmailFlags',
    description: 'Set flags on an email like "Seen" or "Flagged"',
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
      description: 'UID of the email to set flags',
      hint: 'You can use comma separated list of UIDs',
    },
    {
      displayName: 'Email Message-ID (Optional)',
      name: 'messageId',
      type: 'string',
      default: '',
      description: 'Message-ID from email header to identify the email (alternative to UID)',
      hint: 'You can use comma separated list of Message-IDs to set flags on multiple emails at once. Supports partial matching (e.g. @example.com)',
    },
    {
      displayName: 'Flags',
      name: 'flags',
      type: 'collection',
      default: [],
      required: true,
      placeholder: 'Add Flag',
      //  -- Custom flag options must appear after standard boolean flags for better UX
      // eslint-disable-next-line n8n-nodes-base/node-param-collection-type-unsorted-items
      options: [
        {
          displayName: 'Answered',
          name: ImapFlags.Answered,
          type: 'boolean',
          default: false,
          description: 'Whether email is answered',
        },
        {
          displayName: 'Deleted',
          name: ImapFlags.Deleted,
          type: 'boolean',
          default: false,
          description: 'Whether email is deleted',
        },
        {
          displayName: 'Draft',
          name: ImapFlags.Draft,
          type: 'boolean',
          default: false,
          description: 'Whether email is draft',
        },
        {
          displayName: 'Flagged',
          name: ImapFlags.Flagged,
          type: 'boolean',
          default: false,
          description: 'Whether email is flagged',
        },
        {
          displayName: 'Seen',
          name: ImapFlags.Seen,
          type: 'boolean',
          default: false,
          description: 'Whether email is seen',
        },
        {
          displayName: 'Set Custom Flags',
          name: KEY_SET_CUSTOM_FLAGS,
          type: 'string',
          placeholder: '$label1 $label2',
          default: '',
          description: 'Custom IMAP flags to set, space-separated',
        },
        {
          displayName: 'Remove Custom Flags',
          name: KEY_REMOVE_CUSTOM_FLAGS,
          type: 'string',
          placeholder: '$label1 $label2',
          default: '',
          description: 'Custom IMAP flags to remove, space-separated',
        },
      ],
    },
  ],
  async executeImapAction(context: IExecuteFunctions, logger: N8nLogger, itemIndex: number, client: ImapFlow): Promise<INodeExecutionData[] | null> {
    var returnData: INodeExecutionData[] = [];

    const mailboxPath = getMailboxPathFromNodeParameter(context, itemIndex);
    const emailUid = context.getNodeParameter('emailUid', itemIndex) as string;
    const messageId = context.getNodeParameter('messageId', itemIndex, '') as string;
    const flags = context.getNodeParameter('flags', itemIndex) as IDataObject;

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
            message: 'No emails found to set flags',
          },
        });
      }
      return returnData;
    }

    let flagsToSet: string[] = [];
    let flagsToRemove: string[] = [];
    for (const key in flags) {
        if (key === KEY_SET_CUSTOM_FLAGS) {
            const customVal = flags[key] as string;
            const customFlagsList: string[] = splitSpaceSeparatedString(customVal);
            flagsToSet.push(...customFlagsList);
        } else if (key === KEY_REMOVE_CUSTOM_FLAGS) {
            const customVal = flags[key] as string;
            const customFlagsList: string[] = splitSpaceSeparatedString(customVal);
            flagsToRemove.push(...customFlagsList);
        } else {
            if (flags[key]) {
              flagsToSet.push(key);
            } else {
              flagsToRemove.push(key);
            }
        }
    }

    // remove duplicates
    flagsToSet = Array.from(new Set(flagsToSet));
    flagsToRemove = Array.from(new Set(flagsToRemove));

    // in case a flag is both in set and remove, remove it from remove
    flagsToRemove = flagsToRemove.filter(f => !flagsToSet.includes(f));

    const uidList = resolved.uids.join(',');

    // prepare return data
    let jsonData: IDataObject = {
      uid: uidList,
    };

    logger.info(`Setting flags "${flagsToSet.join(',')}" and removing flags "${flagsToRemove.join(',')}" on email(s) "${uidList}"`);

    if (flagsToSet.length > 0) {
      ImapFlowErrorCatcher.getInstance().startErrorCatching();
      const isSuccess : boolean = await client.messageFlagsAdd(uidList, flagsToSet, {
        uid: true,
      });
      if (!isSuccess) {
        const errorsList = ImapFlowErrorCatcher.getInstance().stopAndGetErrorsList();
        throw new NodeImapError(
          context.getNode(),
          "Unable to set flags",
          errorsList
        );
      }
    }
    if (flagsToRemove.length > 0) {
      const isSuccess : boolean = await client.messageFlagsRemove(uidList, flagsToRemove, {
        uid: true,
      });
      if (!isSuccess) {
        const errorsList = ImapFlowErrorCatcher.getInstance().stopAndGetErrorsList();
        throw new NodeImapError(
          context.getNode(),
          "Unable to remove flags", 
          errorsList
        );
      }
    }
    
    returnData.push({
      json: jsonData,
    });

    return returnData;
  },
};
