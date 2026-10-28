export type Kind = 'Film' | 'Série' | 'Animation' | 'Documentaire';
export type PlatformId = 'netflix' | 'prime-video' | 'paramount' | 'disney' | 'marvel';
export interface Availability { platform: Exclude<PlatformId,'marvel'>; country:'FR'; type:'subscription'; sourceURL:string; watchURL:string; checkedAt:string; sourceUpdatedAt?:string }
export interface CatalogueItem {
  title: string; kind: Kind; year: string; rating: string; word?: string; poster: string;
  id?: string; genres?: string[]; collection?: string; overview?: string; image?: string;
  sourceURL?: string; imageSource?: string; ratingSource?: string; votes?: number;
  availability?: Availability[]; marvel?: boolean; platforms?: PlatformId[];
  tmdbId?: number; mediaType?: 'movie'|'tv'; isAnime?: boolean; originalTitle?: string; alternativeTitles?: string[];
  backdrop?: string; releaseDate?: string; runtime?: number|null; metadataLanguage?: string; originalLanguage?: string; imdbId?: string;
  tmdbSeasons?: TMDBSeason[]; episodeCount?: number|null; seasonCount?: number|null;
  catalogueId?:string;featured?:boolean;rank?:number;
  heroBackdrop?:string;
}
export interface TMDBSeason {number:number;title:string;episodes:number|null;airdate:string;image:string}
export interface TMDBPage {items:CatalogueItem[];page:number;totalPages:number;stale:boolean;nextCursor?:string|null}
export interface TMDBAPI {
  enabled():Promise<boolean>; image(value:unknown):string; remember(item:CatalogueItem):CatalogueItem; stored():CatalogueItem[];
  request(path:string,signal?:AbortSignal):Promise<unknown>;
  page(path:string,signal?:AbortSignal):Promise<TMDBPage>;
  detail(id:string,legacy?:CatalogueItem):Promise<{item:CatalogueItem;stale:boolean}|null>;
  season(id:number,season:number):Promise<{episodes:Episode[];stale:boolean}>;
}
export interface DiscoveryCollection { id: string; title: string; description: string; color: string }
export interface DiscoveryData { updatedAt: string; items: CatalogueItem[]; collections: DiscoveryCollection[] }
export interface PlatformCatalogue { country:'FR'; checkedAt:string; items:CatalogueItem[]; collections:DiscoveryCollection[]; providers:Record<PlatformId,{name:string;kind:'service'|'universe';sourceURL:string;itemIds:string[]}> }
export interface Episode {season:number;number:number;title:string;airdate:string;runtime:number|null;overview?:string;image?:string;tmdbId?:number|null}
export interface VideoSource {provider:'vidmoly';embedURL:string;rightsConfirmed:true}
export interface VideoState {draft?:VideoSource|null;approved?:VideoSource|null}
export interface VideoEditorOptions {path:string;version():number;state?:VideoState;changed():Promise<void>}
export interface EpisodeCatalogue {updatedAt:string;shows:Record<string,{sourceURL:string;episodes:Episode[]}>}
export interface TitleNavigation {open(item:CatalogueItem):void;recent():string[];remember(id?:string):void;validId(id:unknown):id is string}
export interface CatalogueUIOptions {dialog:HTMLDialogElement;content:HTMLElement;notice:HTMLElement;onFavoritesChange?:()=>void}
export interface CatalogueUI {createCard(item:CatalogueItem,rank?:number):HTMLElement;showDetails(item:CatalogueItem):void;refresh():void;isFavorite(item:CatalogueItem):boolean}
export interface BrowseFilter { query: string; kind: string; genre?: string; collection?: string; favorites?: boolean }
export interface BrowseAPI {
  items: CatalogueItem[];
  createCard(item: CatalogueItem, rank?: number): HTMLElement;
  showDetails(item: CatalogueItem): void;
  filter(options: Partial<BrowseFilter>): void;
}
export interface Profile { displayName: string; photoURL?: string }
export interface Account extends Profile { uid: string; email: string; provider: string; admin: boolean; profileId?: string;profileReady?:boolean }
export interface LogoutResult { serverCleared: boolean; localCleared: true }
export interface AuthAdapter {
  subscribe(callback: (account: Account | null) => void): () => void;
  signInWithGoogle(): Promise<unknown>;
  signInWithEmail(email: string, password: string): Promise<unknown>;
  createAccount(email: string, password: string, name: string): Promise<unknown>;
  sendPasswordReset(email: string): Promise<void>;
  getIdToken(forceRefresh?: boolean): Promise<string>;
  refreshPermissions(): Promise<boolean>;
  updateAvatar(photoURL: string | null): Promise<void>;
  updateDisplayName(displayName: string): Promise<void>;
  signOut(): Promise<LogoutResult>;
}
export interface AccountAPI {
  signOut():Promise<void>;
  getUser(): Account | null;
  getIdToken(forceRefresh?: boolean): Promise<string>;
  refreshPermissions(): Promise<boolean>;
  updateAvatar(photoURL: string | null): Promise<void>;
  updateDisplayName(displayName: string): Promise<void>;
  subscribe(callback: (account: Account | null) => void): () => void;
  connectAuth(adapter: AuthAdapter): void;
}
export interface ModelAPI {
  normalise(value: string): string;
  filterItems(items: CatalogueItem[], state: BrowseFilter): CatalogueItem[];
  topRated(items: CatalogueItem[], kind: Kind): CatalogueItem[];
  validAvailability(value:unknown):value is Availability;
  platformsFor(item:CatalogueItem):PlatformId[];
  validPhotoURL(value: unknown): value is string;
  validProfile(value: unknown): value is Profile;
  safePoster(value: unknown): string;
  avatarSource(value: unknown): string;
}
export interface SessionAPI {
  pending(): boolean;
  clearServerSession(request?: typeof fetch): Promise<void>;
  signOut(localSignOut: () => Promise<void>, request?: typeof fetch): Promise<LogoutResult>;
}
declare global {
  interface Window {
    HessflixVideoPlayer?:{valid(value:unknown):value is string;create(root:HTMLElement):{show(url:string,title:string):void;clear(message?:string):void}};
    HessflixTitleVideo?:{mount(item:CatalogueItem,series:boolean):void};
    HessflixAdminVideo?:{mount(root:HTMLElement,options:VideoEditorOptions):void;clear():void};
    HessflixAdminCatalogue?:{request(path:string,method?:string,body?:Record<string,unknown>):Promise<unknown>;tab(name:string):void;notify(text:string,error?:boolean):void};
    MovixModel: ModelAPI; MovixSession: SessionAPI;
    MovixDiscovery?: DiscoveryData; MovixBrowse?: BrowseAPI;
    MovixDiscoveryContext?:DiscoveryData; MovixPlatformCatalogue?:PlatformCatalogue;
    MovixCatalogueUI:{create(options:CatalogueUIOptions):CatalogueUI};
    HessflixTitles:TitleNavigation; HessflixEpisodes?:EpisodeCatalogue;
    HessflixTMDB?:TMDBAPI;
    HessflixTMDBEpisodes?:{mount(item:CatalogueItem,titleId:string):void};
    HessflixCatalogueApproved?:boolean;HessflixCatalogueStatus?:'ready'|'unavailable';HessflixCatalogueNext?:string|null;
    MovixAuthAdapter?: AuthAdapter; MovixAccount?: AccountAPI;
    MovixAuthStatus?: {state: string; code: string};
    HessflixPersonal?:{connect():void;favorites():string[];watchlist():string[];message():string;sync():Promise<void>;setFavorite(id:string,value:boolean):Promise<unknown>;setWatchlist(id:string,value:boolean):Promise<unknown>;selection(id:string):{season:number;episode:number}|undefined;saveSelection(id:string,choice:{season:number;episode:number}):Promise<unknown>};
    HessflixActivity?: {
      connect():void;
      flush():Promise<unknown>;
      mountTitle(item:CatalogueItem,series:boolean):void;
      snapshot():{identity:string|null;persistent:boolean;progress:{id:string;status:'in-progress'|'completed';at:number;choice?:{season:number;episode:number}}[];history:{id:string;at:number;choice?:{season:number;episode:number}}[];seconds:number;days:Record<string,number>};
      favorites():string[];removeFavorite(id:string):void;
      mark(item:CatalogueItem,status:'in-progress'|'completed',choice?:{season:number;episode:number}):unknown;
      removeProgress(id:string):unknown;removeHistory(entry:{id:string;choice?:{season:number;episode:number}}):unknown;
      dayKey(time:number):string;
    };
  }
}
