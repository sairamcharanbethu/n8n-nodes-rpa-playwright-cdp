import { INodeType, INodeTypeDescription, IExecuteFunctions, INodeExecutionData, NodeConnectionType } from 'n8n-workflow';
import { launchGoogleSession } from '../../utils/sessionManager';
import { SessionObject } from '../../utils/SessionObject';

export class LaunchBrowser implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Launch Browser',
    name: 'launchBrowser',
    group: ['transform'],
    version: 1,
    description: 'Launches a Playwright Chrome session via Selenium Grid and returns session info',
    defaults: {
      name: 'Launch Browser',
    },
    inputs: [NodeConnectionType.Main],
    outputs: [NodeConnectionType.Main],
    properties: [
      {
        displayName: 'Selenium Hub URL',
        name: 'seleniumHubUrl',
        type: 'string',
        default: 'http://selenium-hub:4444',
        required: true,
      },
      {
        displayName: 'Profile Directory',
        name: 'profileDir',
        type: 'string',
        default: '/home/seluser/chrome-profiles/n8n-demo',
        required: true,
      },
      {
        displayName: 'Navigate To URL',
        name: 'navigateUrl',
        type: 'string',
        default: 'https://practicetestautomation.com/practice-test-login/',
        required: true,
      },
      {
        displayName: 'Additional Browser Args',
        name: 'browserArgs',
        type: 'string',
        default: '',
        description: 'Comma-separated extra Chrome/Chromium arguments, e.g. --incognito,--disable-gpu',
      },
      {
        displayName: 'Window Size',
        name: 'windowSize',
        type: 'string',
        default: '1920,1080',
        description: 'Resolution for the Chrome window, e.g. 1920,1080'
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const seleniumHubUrl = this.getNodeParameter('seleniumHubUrl', 0) as string;
    const profileDir = this.getNodeParameter('profileDir', 0) as string;
    const navigateUrl = this.getNodeParameter('navigateUrl', 0) as string;
    const browserArgsRaw = this.getNodeParameter('browserArgs', 0) as string;
    const windowSize = this.getNodeParameter('windowSize', 0) as string;

    const browserArgs =
      browserArgsRaw
        .split(',')
        .map((arg) => arg.trim())
        .filter((arg) => !!arg);

    const session: SessionObject = await launchGoogleSession({
      seleniumHubUrl,
      profileDir,
      navigateUrl,
      browserArgs,
      windowSize,
    });

    return [[{ json: { ...session } }]];
  }
}
