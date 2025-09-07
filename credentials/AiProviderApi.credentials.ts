import { ICredentialType, NodePropertyTypes } from 'n8n-workflow';

export class AiProviderApi implements ICredentialType {
	name = 'aiProviderApi';
	displayName = 'AI Provider API';
	documentationUrl = '';
	properties = [
		{
			displayName: 'Provider',
			name: 'provider',
			type: 'options' as NodePropertyTypes,
			options: [
				{ name: 'OpenAI', value: 'openai' },
				{ name: 'OpenRouter', value: 'openrouter' },
				{ name: 'Google Gemini', value: 'gemini' },
			],
			default: 'openai',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string' as NodePropertyTypes,
			typeOptions: { password: true },
			default: '',
			displayOptions: {
				show: {
					provider: ['openai', 'openrouter'],
				},
			},
		},
		{
			displayName: 'Google Gemini API Key',
			name: 'googleApiKey',
			type: 'string' as NodePropertyTypes,
			typeOptions: { password: true },
			default: '',
			displayOptions: {
				show: {
					provider: ['gemini'],
				},
			},
		},
	];
}
