import * as publicIp from 'public-ip';
import * as portFinder from 'portfinder';
import { PolkaRequest, PolkaResponse } from 'polka';
// tslint:disable-next-line:no-duplicate-imports factory method is namespace root
import * as polka from 'polka';
import * as https from 'https';
import TwitchClient, { extractUserId, HelixFollow, HelixStream, HelixUser, UserIdResolvable } from 'twitch';
import * as getRawBody from 'raw-body';

import Subscription from './Subscriptions/Subscription';
import UserChangeSubscription from './Subscriptions/UserChangeSubscription';
import FollowsToUserSubscription from './Subscriptions/FollowsToUserSubscription';
import FollowsFromUserSubscription from './Subscriptions/FollowsFromUserSubscription';
import StreamChangeSubscription from './Subscriptions/StreamChangeSubscription';

interface WebHookListenerCertificateConfig {
	key: string;
	cert: string;
}

interface WebHookListenerReverseProxyConfig {
	port?: number;
	ssl?: boolean;
	pathPrefix?: string;
}

interface WebHookListenerConfig {
	hostName?: string;
	port?: number;
	ssl?: WebHookListenerCertificateConfig;
	reverseProxy?: WebHookListenerReverseProxyConfig;
}

interface WebHookListenerComputedConfig {
	hostName: string;
	port: number;
	ssl?: WebHookListenerCertificateConfig;
	reverseProxy: Required<WebHookListenerReverseProxyConfig>;
}

export default class WebHookListener {
	private _server?: polka.Polka;
	private readonly _subscriptions = new Map<string, Subscription>();

	static async create(client: TwitchClient, config: WebHookListenerConfig = {}) {
		const listenerPort = config.port || await portFinder.getPortPromise();
		const reverseProxy = config.reverseProxy || {};
		return new WebHookListener(
			{
				hostName: config.hostName || await publicIp.v4(),
				port: listenerPort,
				ssl: config.ssl,
				reverseProxy: {
					port: reverseProxy.port || listenerPort,
					ssl: (reverseProxy.ssl !== undefined) ? reverseProxy.ssl : !!config.ssl,
					pathPrefix: reverseProxy.pathPrefix || ''
				}
			},
			client
		);
	}

	private constructor(private readonly _config: WebHookListenerComputedConfig, /** @private */ readonly _twitchClient: TwitchClient) {
	}

	private _handleVerification(req: PolkaRequest, res: PolkaResponse) {
		const subscription = this._subscriptions.get(req.params.id);
		if (subscription) {
			if (req.query['hub.mode'] === 'subscribe') {
				subscription.verify();
				res.writeHead(202);
				res.end(req.query['hub.challenge']);
			} else {
				this._subscriptions.delete(req.params.id);
				res.writeHead(200);
				res.end();
			}
		} else {
			res.writeHead(410);
			res.end();
		}
	}

	private async _handleNotification(req: PolkaRequest, res: PolkaResponse) {
		const body = await getRawBody(req, true);
		const subscription = this._subscriptions.get(req.params.id);
		if (subscription) {
			subscription.handleData(body, req.headers['x-hub-signature']! as string);
			res.writeHead(202);
			res.end();
		} else {
			res.writeHead(410);
			res.end();
		}
	}

	listen() {
		if (this._server) {
			throw new Error('Trying to listen while already listening');
		}
		if (this._config.ssl) {
			const server = https.createServer({
				key: this._config.ssl.key,
				cert: this._config.ssl.cert
			});
			this._server = polka({ server });
		} else {
			this._server = polka();
		}
		this._server.add('GET', '/:id', (req, res) => { this._handleVerification(req, res); });
		// tslint:disable-next-line:no-floating-promises
		this._server.add('POST', '/:id', (req, res) => { this._handleNotification(req, res); });
		this._server.listen(this._config.port);

		for (const [, sub] of this._subscriptions) {
			// tslint:disable-next-line:no-floating-promises
			sub.start();
		}
	}

	unlisten() {
		if (!this._server) {
			throw new Error('Trying to unlisten while not listening');
		}

		this._server.server.close();
		this._server = undefined;

		for (const [, sub] of this._subscriptions) {
			// tslint:disable-next-line:no-floating-promises
			sub.stop();
		}
	}

	buildHookUrl(id: string) {
		const protocol = this._config.reverseProxy.ssl ? 'https' : 'http';

		let hostName = this._config.hostName;

		if (this._config.reverseProxy.port !== (this._config.reverseProxy.ssl ? 443 : 80)) {
			hostName += `:${this._config.reverseProxy.port}`;
		}

		// trim slashes on both ends
		const pathPrefix = this._config.reverseProxy.pathPrefix.replace(/^\/|\/$/, '');

		return `${protocol}://${hostName}${pathPrefix ? '/' : ''}${pathPrefix}/${id}`;
	}

	async subscribeToUserChanges(user: UserIdResolvable, handler: (user: HelixUser) => void, withEmail: boolean = false) {
		const userId = extractUserId(user);

		const subscription = new UserChangeSubscription(userId, handler, withEmail, this);
		await subscription.start();
		this._subscriptions.set(subscription.id!, subscription);

		return subscription;
	}

	async subscribeToFollowsToUser(user: UserIdResolvable, handler: (follow: HelixFollow) => void) {
		const userId = extractUserId(user);

		const subscription = new FollowsToUserSubscription(userId, handler, this);
		await subscription.start();
		this._subscriptions.set(subscription.id!, subscription);

		return subscription;
	}

	async subscribeToFollowsFromUser(user: UserIdResolvable, handler: (follow: HelixFollow) => void) {
		const userId = extractUserId(user);

		const subscription = new FollowsFromUserSubscription(userId, handler, this);
		await subscription.start();
		this._subscriptions.set(subscription.id!, subscription);

		return subscription;
	}

	async subscribeToStreamChanges(user: UserIdResolvable, handler: (follow: HelixStream) => void) {
		const userId = extractUserId(user);

		const subscription = new StreamChangeSubscription(userId, handler, this);
		await subscription.start();
		this._subscriptions.set(subscription.id!, subscription);

		return subscription;
	}

	/** @private */
	_changeIdOfSubscription(oldId: string, newId: string) {
		const sub = this._subscriptions.get(oldId);
		if (sub) {
			this._subscriptions.delete(oldId);
			this._subscriptions.set(newId, sub);
		}
	}

	/** @private */
	_dropSubscription(id: string) {
		this._subscriptions.delete(id);
	}
}
