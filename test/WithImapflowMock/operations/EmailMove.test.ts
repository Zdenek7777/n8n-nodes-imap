import { IExecuteFunctions } from 'n8n-workflow';
import { getGlobalImapMock } from '../setup';
import { createImapflowMock, MockImapServer } from '../../TestUtils/ImapflowMock';
import { createNodeParametersCheckerMock } from '../../TestUtils/N8nMocks';
import { moveEmailOperation } from '../../../nodes/Imap/operations/email/functions/EmailMove';

describe('EmailMove', () => {
  const ITEM_INDEX = 0;
  let globalImapMock: MockImapServer;
  let mockImapflow: any;

  beforeEach(async () => {
    globalImapMock = getGlobalImapMock();

    const credentials = MockImapServer.getValidCredentials();

    mockImapflow = createImapflowMock(globalImapMock, {
      user: credentials.user,
      password: credentials.password,
    });
    await mockImapflow.connect();
  });

  describe('executeImapAct basic functionality', () => {

    it('should move email from source to destination mion -ailbox', async () => {
      // Arrange
      const paramValues = {
        sourceMailbox: { value: 'INBOX' },
        emailUid: '123',
        messageId: '',
        destinationMailbox: { value: 'Sent' },
        markAsSeen: false,
      };
      const context = createNodeParametersCheckerMock(moveEmailOperation.parameters, paramValues);

      // Mock the messageMove response
      const mockMoveResponse = {
        uid: '123',
        path: 'Sent',
        moved: true,
      };
      mockImapflow.messageMove = jest.fn().mockResolvedValue(mockMoveResponse);

      // Act
      const result = await moveEmailOperation.executeImapAction(
        context as IExecuteFunctions,
        context.logger!,
        ITEM_INDEX,
        mockImapflow
      );

      // Assert
      expect(result).toBeDefined();
      expect(result?.length).toBe(1);
      expect(result).toEqual([
        {
          "json": {
            ...mockMoveResponse,
            markedAsSeen: false,
          }
        }
      ]);
      expect(mockImapflow.mailboxOpen).toHaveBeenCalledWith('INBOX', { readOnly: false });
      expect(mockImapflow.messageMove).toHaveBeenCalledWith('123', 'Sent', { uid: true });
    });


    it('should handle "false" response from messageMove by throwing an error', async () => {
      // Arrange
      const paramValues = {
        sourceMailbox: { value: 'INBOX' },
        emailUid: '999',
        messageId: '',
        destinationMailbox: { value: 'Sent' },
        markAsSeen: false,
      };
      const context = createNodeParametersCheckerMock(moveEmailOperation.parameters, paramValues);
      // Mock the messageMove response to be false
      mockImapflow.messageMove = jest.fn().mockResolvedValue(false);
      // Act
      try {
        await moveEmailOperation.executeImapAction(
          context as IExecuteFunctions,
          context.logger!,
          ITEM_INDEX,
          mockImapflow
        );
        fail('Expected error was not thrown');
      } catch (error) {
        // Assert
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should move email and mark as seen when markAsSeen is true', async () => {
      // Arrange
      const paramValues = {
        sourceMailbox: { value: 'INBOX' },
        emailUid: '123',
        messageId: '',
        destinationMailbox: { value: 'Sent' },
        markAsSeen: true,
      };
      const context = createNodeParametersCheckerMock(moveEmailOperation.parameters, paramValues);

      // Mock the messageMove response with uidMap
      const mockMoveResponse = {
        uid: '123',
        path: 'Sent',
        moved: true,
        uidMap: new Map([[123, 456]]), // source UID -> destination UID
      };
      mockImapflow.messageMove = jest.fn().mockResolvedValue(mockMoveResponse);
      mockImapflow.messageFlagsAdd = jest.fn().mockResolvedValue(true);
      // Override mailboxOpen to allow opening destination mailbox
      mockImapflow.mailboxOpen = jest.fn().mockResolvedValue({ path: 'Sent' });

      // Act
      const result = await moveEmailOperation.executeImapAction(
        context as IExecuteFunctions,
        context.logger!,
        ITEM_INDEX,
        mockImapflow
      );

      // Assert
      expect(result).toBeDefined();
      expect(result?.length).toBe(1);
      expect(result![0].json.markedAsSeen).toBe(true);
      expect(mockImapflow.messageMove).toHaveBeenCalledWith('123', 'Sent', { uid: true });
      // Should open destination mailbox and set Seen flag
      expect(mockImapflow.mailboxOpen).toHaveBeenCalledWith('Sent', { readOnly: false });
      expect(mockImapflow.messageFlagsAdd).toHaveBeenCalledWith('456', ['\\Seen'], { uid: true });
    });

    it('should move email without marking as seen when markAsSeen is false', async () => {
      // Arrange
      const paramValues = {
        sourceMailbox: { value: 'INBOX' },
        emailUid: '123',
        messageId: '',
        destinationMailbox: { value: 'Sent' },
        markAsSeen: false,
      };
      const context = createNodeParametersCheckerMock(moveEmailOperation.parameters, paramValues);

      // Mock the messageMove response
      const mockMoveResponse = {
        uid: '123',
        path: 'Sent',
        moved: true,
        uidMap: new Map([[123, 456]]),
      };
      mockImapflow.messageMove = jest.fn().mockResolvedValue(mockMoveResponse);
      mockImapflow.messageFlagsAdd = jest.fn().mockResolvedValue(true);

      // Act
      const result = await moveEmailOperation.executeImapAction(
        context as IExecuteFunctions,
        context.logger!,
        ITEM_INDEX,
        mockImapflow
      );

      // Assert
      expect(result).toBeDefined();
      expect(result?.length).toBe(1);
      expect(result![0].json.markedAsSeen).toBe(false);
      expect(mockImapflow.messageMove).toHaveBeenCalledWith('123', 'Sent', { uid: true });
      // Should NOT set Seen flag when markAsSeen is false
      expect(mockImapflow.messageFlagsAdd).not.toHaveBeenCalled();
    });



  }); // end executeImapAction - basic functionality

}); // end EmailMove