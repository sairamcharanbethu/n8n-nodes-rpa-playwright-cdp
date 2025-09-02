import { INodeType, INodeTypeDescription, IExecuteFunctions, INodeExecutionData, NodeConnectionType } from 'n8n-workflow';
import { navigateWithSession } from '../../utils/sessionManager';
import { SessionObject } from '../../utils/SessionObject';

export class Navigate implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Navigate',
    name: 'navigate',
    group: ['transform'],
    version: 1,
    description: 'Navigate to a URL using an existing browser session',
    defaults: {
      name: 'Navigate',
    },
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],
    properties: [
      {
        displayName: 'URL to Navigate',
        name: 'navigateUrl',
        type: 'string',
        default: 'https://example.com/',
        required: true,
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const results: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      const session: SessionObject = items[i].json as unknown as SessionObject;
      const navigateUrl = this.getNodeParameter('navigateUrl', i) as string;

      const newSession = await navigateWithSession(session, navigateUrl);
      results.push({ json: { ...newSession } });
    }
    return [results];
  }
}
