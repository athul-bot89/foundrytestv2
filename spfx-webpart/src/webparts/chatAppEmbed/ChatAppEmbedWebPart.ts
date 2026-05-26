import { Version } from '@microsoft/sp-core-library';
import {
  type IPropertyPaneConfiguration,
  PropertyPaneTextField
} from '@microsoft/sp-property-pane';
import { BaseClientSideWebPart } from '@microsoft/sp-webpart-base';
import type { AadTokenProvider } from '@microsoft/sp-http';

export interface IChatAppEmbedWebPartProps {
  /** Full HTTPS URL where the React chat app is hosted */
  iframeUrl: string;
  /** Azure AD Application ID URI for the backend API (e.g. api://xxx-xxx) */
  apiResourceUri: string;
}

export default class ChatAppEmbedWebPart extends BaseClientSideWebPart<IChatAppEmbedWebPartProps> {

  private _tokenProvider: AadTokenProvider | undefined;
  private _messageHandler: ((event: MessageEvent) => void) | undefined;

  protected async onInit(): Promise<void> {
    // Acquire the AAD token provider during web part initialization
    this._tokenProvider = await this.context.aadTokenProviderFactory.getTokenProvider();
    return super.onInit();
  }

  public render(): void {
    const iframeUrl = this.properties.iframeUrl;

    if (!iframeUrl) {
      this.domElement.innerHTML = `
        <div style="padding:20px;text-align:center;color:#605e5c;font-family:'Segoe UI',sans-serif;">
          <h3>Chat App Embed</h3>
          <p>Please configure the <strong>React App URL</strong> in the web part properties panel.</p>
        </div>
      `;
      return;
    }

    this.domElement.innerHTML = `
      <div style="width:100%;height:700px;position:relative;border-radius:8px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
        <iframe
          id="chatAppFrame-${this.instanceId}"
          src="${this._escapeHtml(iframeUrl)}"
          style="width:100%;height:100%;border:none;"
          allow="clipboard-write"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        ></iframe>
      </div>
    `;

    const iframe = this.domElement.querySelector(`#chatAppFrame-${this.instanceId}`) as HTMLIFrameElement;

    // Clean up any previous listener
    if (this._messageHandler) {
      window.removeEventListener('message', this._messageHandler);
    }

    // Listen for token requests from the iframe
    this._messageHandler = (event: MessageEvent) => this._handleIframeMessage(event, iframe);
    window.addEventListener('message', this._messageHandler);

    // Send token when iframe loads (handles race condition where
    // the iframe sends REQUEST_TOKEN before we attach the listener)
    iframe.addEventListener('load', () => {
      this._sendTokenToIframe(iframe);
    });
  }

  /**
   * Handle incoming postMessage from the embedded iframe.
   * Only responds to REQUEST_TOKEN messages from the expected origin.
   */
  private async _handleIframeMessage(event: MessageEvent, iframe: HTMLIFrameElement): Promise<void> {
    if (!iframe || !this.properties.iframeUrl) return;

    // Validate that the message comes from our iframe's origin
    const iframeOrigin = new URL(this.properties.iframeUrl).origin;
    if (event.origin !== iframeOrigin) return;

    if (event.data && event.data.type === 'REQUEST_TOKEN') {
      await this._sendTokenToIframe(iframe);
    }
  }

  /**
   * Acquire a bearer token for the backend API and post it to the iframe
   * along with the current user's display name and email.
   */
  private async _sendTokenToIframe(iframe: HTMLIFrameElement): Promise<void> {
    if (!this._tokenProvider || !this.properties.apiResourceUri) {
      console.warn('[ChatAppEmbed] Token provider or API resource URI not configured.');
      return;
    }

    try {
      // Acquire token scoped to the backend API
      const token: string = await this._tokenProvider.getToken(this.properties.apiResourceUri);

      // Get user info from the SharePoint page context
      const user = {
        name: this.context.pageContext.user.displayName,
        email: this.context.pageContext.user.email || this.context.pageContext.user.loginName
      };

      // Post token to the iframe (restricted to iframe's origin only)
      const targetOrigin = new URL(this.properties.iframeUrl).origin;
      iframe.contentWindow?.postMessage(
        {
          type: 'AUTH_TOKEN',
          token: token,
          user: user
        },
        targetOrigin
      );

      console.log('[ChatAppEmbed] Token sent to iframe successfully.');
    } catch (error) {
      console.error('[ChatAppEmbed] Failed to acquire token:', error);
      // Optionally notify the iframe of the error
      const targetOrigin = new URL(this.properties.iframeUrl).origin;
      iframe.contentWindow?.postMessage(
        {
          type: 'AUTH_ERROR',
          error: 'Failed to acquire bearer token. Please contact your administrator.'
        },
        targetOrigin
      );
    }
  }

  /** Simple HTML escaping to prevent XSS in iframe src */
  private _escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  protected onDispose(): void {
    if (this._messageHandler) {
      window.removeEventListener('message', this._messageHandler);
      this._messageHandler = undefined;
    }
  }

  protected get dataVersion(): Version {
    return Version.parse('1.0');
  }

  protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
    return {
      pages: [
        {
          header: {
            description: 'Configure the embedded Chat App and token settings.'
          },
          groups: [
            {
              groupName: 'App Settings',
              groupFields: [
                PropertyPaneTextField('iframeUrl', {
                  label: 'React App URL',
                  description: 'The full HTTPS URL where your React chat app is hosted (e.g., https://your-app.azurestaticapps.net)',
                  placeholder: 'https://your-app.azurestaticapps.net'
                }),
                PropertyPaneTextField('apiResourceUri', {
                  label: 'Backend API Resource URI',
                  description: 'The resource to get a token for. Use https://graph.microsoft.com for Graph, or api://your-app-id for a custom backend.',
                  placeholder: 'https://graph.microsoft.com'
                })
              ]
            }
          ]
        }
      ]
    };
  }
}
