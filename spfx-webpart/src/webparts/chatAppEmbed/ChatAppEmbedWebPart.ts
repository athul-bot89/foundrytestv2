import { Version } from '@microsoft/sp-core-library';
import {
  type IPropertyPaneConfiguration,
  PropertyPaneTextField
} from '@microsoft/sp-property-pane';
import { BaseClientSideWebPart } from '@microsoft/sp-webpart-base';
import { AadTokenProvider } from '@microsoft/sp-http';

export interface IChatAppEmbedWebPartProps {
  iframeUrl: string;
  apiResourceUri: string;
}

export default class ChatAppEmbedWebPart extends BaseClientSideWebPart<IChatAppEmbedWebPartProps> {

  private _tokenProvider: AadTokenProvider | undefined;

  protected async onInit(): Promise<void> {
    // Get the AAD token provider during initialization
    this._tokenProvider = await this.context.aadTokenProviderFactory.getTokenProvider();
    return super.onInit();
  }

  public render(): void {
    const iframeUrl = this.properties.iframeUrl || 'https://YOUR-HOSTED-REACT-APP-URL';
    
    this.domElement.innerHTML = `
      <div style="width:100%;height:700px;position:relative;">
        <iframe
          id="chatAppFrame"
          src="${this._escapeHtml(iframeUrl)}"
          style="width:100%;height:100%;border:none;border-radius:8px;"
          allow="clipboard-write"
        ></iframe>
      </div>
    `;

    const iframe = this.domElement.querySelector('#chatAppFrame') as HTMLIFrameElement;
    
    // Listen for token requests from the iframe
    window.addEventListener('message', this._handleIframeMessage.bind(this));
    
    // Also send token when iframe loads (handles race condition)
    iframe.addEventListener('load', () => {
      this._sendTokenToIframe(iframe);
    });
  }

  private async _handleIframeMessage(event: MessageEvent): Promise<void> {
    const iframe = this.domElement.querySelector('#chatAppFrame') as HTMLIFrameElement;
    if (!iframe) return;

    // Only respond to messages from our iframe
    const iframeUrl = this.properties.iframeUrl || 'https://YOUR-HOSTED-REACT-APP-URL';
    const iframeOrigin = new URL(iframeUrl).origin;
    if (event.origin !== iframeOrigin) return;

    if (event.data && event.data.type === 'REQUEST_TOKEN') {
      await this._sendTokenToIframe(iframe);
    }
  }

  private async _sendTokenToIframe(iframe: HTMLIFrameElement): Promise<void> {
    if (!this._tokenProvider) return;

    const apiResourceUri = this.properties.apiResourceUri || 'api://YOUR-BACKEND-APP-ID';
    
    try {
      // Acquire token for the custom backend API
      const token = await this._tokenProvider.getToken(apiResourceUri);
      
      // Get user info from page context
      const user = {
        name: this.context.pageContext.user.displayName,
        email: this.context.pageContext.user.email || this.context.pageContext.user.loginName
      };

      // Post token to the iframe
      const iframeUrl = this.properties.iframeUrl || 'https://YOUR-HOSTED-REACT-APP-URL';
      const targetOrigin = new URL(iframeUrl).origin;
      
      iframe.contentWindow?.postMessage(
        { type: 'AUTH_TOKEN', token, user },
        targetOrigin
      );
    } catch (error) {
      console.error('[ChatAppEmbed] Failed to acquire token:', error);
    }
  }

  private _escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  protected onDispose(): void {
    window.removeEventListener('message', this._handleIframeMessage.bind(this));
  }

  protected get dataVersion(): Version {
    return Version.parse('1.0');
  }

  protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
    return {
      pages: [
        {
          header: {
            description: 'Configure the Chat App Embed web part'
          },
          groups: [
            {
              groupName: 'Settings',
              groupFields: [
                PropertyPaneTextField('iframeUrl', {
                  label: 'React App URL',
                  description: 'The full HTTPS URL where your React chat app is hosted',
                  placeholder: 'https://your-app.azurestaticapps.net'
                }),
                PropertyPaneTextField('apiResourceUri', {
                  label: 'API Resource URI',
                  description: 'The Application ID URI of your backend API (e.g., api://your-app-id)',
                  placeholder: 'api://xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
                })
              ]
            }
          ]
        }
      ]
    };
  }
}
