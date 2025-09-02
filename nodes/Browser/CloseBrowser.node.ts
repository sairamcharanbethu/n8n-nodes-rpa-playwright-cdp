import { INodeType, INodeTypeDescription, IExecuteFunctions, INodeExecutionData, NodeConnectionType } from 'n8n-workflow';
import { closeSession } from '../../utils/sessionManager';
import { SessionObject } from '../../utils/SessionObject';

export class CloseBrowser implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Close Browser',
    name: 'closeBrowser',
    group: ['transform'],
    version: 1,
    description: 'Closes the browser/session created by previous nodes',
    defaults: {
      name: 'Close Browser',
    },
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],
    properties: [],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const results: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const session: SessionObject = items[i].json as unknown as SessionObject;
      const closedSession = await closeSession(session);
      results.push({ json: closedSession as unknown as { [key: string]: any } });
    }
    return [results];
  }
}
