import Subscription from './Subscription';
import { HelixResponse, HelixUser } from 'twitch';
import WebHookListener from '../WebHookListener';
import { HelixUserData } from 'twitch/lib/API/Helix/User/HelixUser';

export default class UserChangeSubscription extends Subscription<HelixUser> {
	constructor(private readonly _userId: string, handler: (data: HelixUser) => void, private readonly _withEmail: boolean, client: WebHookListener) {
		super(handler, client);
	}

	protected async _subscribe() {
		return this._client._twitchClient.helix.webHooks.subscribeToUserChanges(this._userId, this._options, this._withEmail);
	}

	protected async _unsubscribe() {
		return this._client._twitchClient.helix.webHooks.unsubscribeFromUserChanges(this._userId, this._options);
	}

	transformData(response: HelixResponse<HelixUserData>) {
		return new HelixUser(response.data[0], this._client._twitchClient);
	}
}
