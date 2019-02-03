import Subscription from './Subscription';
import { HelixResponse, HelixStream } from 'twitch';
import WebHookListener from '../WebHookListener';
import { HelixStreamData } from 'twitch/lib/API/Helix/Stream/HelixStream';

export default class StreamChangeSubscription extends Subscription<HelixStream> {
	constructor(private readonly _userId: string, handler: (data: HelixStream) => void, client: WebHookListener) {
		super(handler, client);
	}

	protected async _subscribe() {
		return this._client._twitchClient.helix.webHooks.subscribeToStreamChanges(this._userId, this._options);
	}

	protected async _unsubscribe() {
		return this._client._twitchClient.helix.webHooks.unsubscribeFromStreamChanges(this._userId, this._options);
	}

	transformData(data: HelixResponse<HelixStreamData>) {
		return new HelixStream(data.data[0], this._client._twitchClient);
	}
}
