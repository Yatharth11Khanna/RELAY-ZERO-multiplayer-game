import { useEffect, useState, type FormEvent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowRight, Check, Clock3, Copy, CornerDownLeft, Crown, DoorOpen, LockKeyhole, MessageSquareText, Radio, RotateCcw, Send, Shield, Signal, Sparkles, TriangleAlert, Users, Wifi, X } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useRelaySocket, type RoomMessage, type RoomSnapshot } from '@/hooks/useRelaySocket';
import { ServerStatus } from '@/components/ServerStatus';
import { SignalGlyph, signalSymbols } from '@/components/SignalGlyph';
import './index.css';

const queryClient = new QueryClient();

function Logo() {
  return (
    <div className="brand-lockup" data-testid="brand-relay-zero">
      <div className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <span>RELAY <b>ZERO</b></span>
    </div>
  );
}

function AppShell() {
  const game = useRelaySocket();
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [chatDraft, setChatDraft] = useState('');
  const [sequence, setSequence] = useState<string[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (game.room?.phase !== 'playing' || !game.room.deadlineAt) {
      setRemaining(null);
      return;
    }
    const updateTime = () => {
      const rawDeadline = game.room?.deadlineAt;
      const end = typeof rawDeadline === 'number'
        ? rawDeadline < 1000000000000 ? rawDeadline * 1000 : rawDeadline
        : new Date(rawDeadline ?? '').getTime();
      setRemaining(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
    };
    updateTime();
    const ticker = window.setInterval(updateTime, 250);
    return () => window.clearInterval(ticker);
  }, [game.room?.deadlineAt, game.room?.phase]);

  useEffect(() => {
    setSequence([]);
  }, [game.room?.roundId]);

  const isHost = Boolean(game.room && game.playerId && game.room.hostPlayerId === game.playerId);
  const canStart = Boolean(game.room && game.room.players.length >= 2 && game.room.players.every((player) => player.connected));
  const phase = game.room?.phase;
  const timerPercent = remaining === null ? 100 : Math.max(0, Math.min(100, (remaining / 75) * 100));

  const copyRoomCode = async () => {
    if (!game.room?.roomCode) return;
    try {
      await navigator.clipboard.writeText(game.room.roomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      game.clearError();
    }
  };

  const handleJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!playerName.trim() || !roomCode.trim()) return;
    await game.joinRoom(roomCode.trim().toUpperCase(), playerName.trim());
  };

  const handleChat = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = chatDraft.trim();
    if (!message) return;
    const ack = await game.sendChat(message);
    if (ack.ok) setChatDraft('');
  };

  const addSymbol = (symbol: string) => {
    setSequence((current) =>
      current.length >= 4 || current.includes(symbol)
        ? current
        : [...current, symbol],
    );
  };

  const removeLastSymbol = () => setSequence((current) => current.slice(0, -1));
  const clearSequence = () => setSequence([]);

  const chatContents = (
    <ChatPanel
      messages={game.messages}
      playerId={game.playerId}
      value={chatDraft}
      onChange={setChatDraft}
      onSubmit={handleChat}
      disabled={!game.room || game.busy || game.connection !== 'connected'}
    />
  );

  return (
    <main className="app-frame">
      <div className="signal-grid" aria-hidden="true" />
      <header className="topbar">
        <Logo />
        <div className="topbar-center"><span className="live-led" /> SHARED FREQUENCY <span className="tiny-divider">/</span> CO-OP SIGNAL DECODING</div>
        <div className="topbar-right"><ServerStatus socketState={game.connection} /></div>
      </header>

      {game.error && (
        <div className="error-banner" role="alert" data-testid="status-error">
          <TriangleAlert size={16} />
          <span>{game.error}</span>
          {game.connection !== 'connected' && <button type="button" onClick={game.retryConnection} data-testid="button-retry-connection">Retry connection</button>}
          <button type="button" onClick={game.clearError} aria-label="Dismiss message" data-testid="button-dismiss-error"><X size={15} /></button>
        </div>
      )}

      {!game.room && (
        <Landing
          name={playerName}
          code={roomCode}
          onNameChange={setPlayerName}
          onCodeChange={setRoomCode}
          onCreate={() => game.createRoom(playerName.trim())}
          onJoin={handleJoin}
          busy={game.busy}
          connection={game.connection}
        />
      )}

      {game.room && phase === 'lobby' && (
        <Lobby
          room={game.room}
          playerId={game.playerId}
          isHost={isHost}
          canStart={canStart}
          busy={game.busy}
          copied={copied}
          onCopy={copyRoomCode}
          onStart={game.startGame}
          onLeave={game.leaveRoom}
        />
      )}

      {game.room && phase === 'playing' && (
        <section className="game-layout rise-in" data-testid="screen-active-round">
          <div className="game-main">
            <div className="round-heading">
              <div>
                <div className="eyebrow"><span className="eyebrow-dot" /> LIVE DECODING <span className="eyebrow-sep">/</span> ROUND {String(game.room.roundNumber).padStart(2, '0')}</div>
                <h1>Build the <em>signal.</em></h1>
                <p className="subhead">Your clue is private. Share what you know. Agree on the sequence together.</p>
              </div>
              <div className={`timer-box ${remaining !== null && remaining < 16 ? 'timer-urgent' : ''}`} data-testid="status-round-timer">
                <Clock3 size={16} />
                <span className="timer-digits">{remaining === null ? '--:--' : formatCountdown(remaining)}</span>
                <div className="timer-track"><span style={{ width: `${timerPercent}%` }} /></div>
              </div>
            </div>

            <div className="attempt-score-row">
              <div className="attempts-block" data-testid="status-attempts">
                <span className="micro-label">ATTEMPTS LEFT</span>
                <div className="attempt-pips">{[0, 1, 2].map((index) => <span className={index < game.room!.attemptsRemaining ? 'pip pip-on' : 'pip'} key={index} />)}</div>
              </div>
              <div className="score-block" data-testid="text-team-score"><span className="micro-label">TEAM SCORE</span><strong>{game.room.score}</strong></div>
            </div>

            <section className="clue-section">
              <div className="section-topline">
                <div><span className="section-index">01</span><h2>Your intel</h2></div>
                <span className="private-tag"><LockKeyhole size={12} /> PRIVATE TO YOU</span>
              </div>
              {game.clues.length > 0 ? (
                <div className="clue-list" data-testid="list-private-clues">
                  {game.clues.map((clue, index) => (
                    <article className="clue-card" key={clue.id} data-testid={`card-clue-${clue.id}`}>
                      <span className="clue-number">0{index + 1}</span>
                      <span>{clue.text}</span>
                      <span className="clue-spark"><Signal size={15} /></span>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="clue-wait" data-testid="status-clue-loading">
                  <div className="skeleton-line" />
                  <span>Waiting for your private signal…</span>
                </div>
              )}
            </section>

            <section className="sequence-section">
              <div className="section-topline">
                <div><span className="section-index">02</span><h2>Shared sequence</h2></div>
                <span className="sequence-count" data-testid="text-sequence-count">{sequence.length} <i>/</i> 4</span>
              </div>
              <p className="section-copy">Talk it out in the channel. Tap symbols in order to compose your team's answer.</p>
              <div className="sequence-slots" role="group" aria-label="Your sequence" data-testid="group-sequence">
                {[0, 1, 2, 3].map((index) => (
                  <div className={`sequence-slot ${sequence[index] ? 'slot-filled' : ''}`} key={index} data-testid={`slot-sequence-${index + 1}`}>
                    <span className="slot-index">0{index + 1}</span>
                    {sequence[index] ? <SignalGlyph symbol={sequence[index]} size={25} /> : <span className="slot-placeholder">·</span>}
                  </div>
                ))}
              </div>
              <div className="symbol-picker" role="group" aria-label="Available signal symbols">
                {signalSymbols.map((symbol, index) => (
                  <button className={`symbol-button symbol-${symbol.id}`} type="button" onClick={() => addSymbol(symbol.glyph)} disabled={sequence.length >= 4 || sequence.includes(symbol.glyph) || game.busy} key={symbol.id} aria-label={`Add ${symbol.label}`} data-testid={`button-symbol-${symbol.id}`}>
                    <SignalGlyph symbol={symbol.glyph} size={21} />
                    <span>{String(index + 1).padStart(2, '0')}</span>
                  </button>
                ))}
                <button className="icon-button sequence-undo" type="button" onClick={removeLastSymbol} disabled={!sequence.length || game.busy} aria-label="Undo last symbol" data-testid="button-sequence-undo"><RotateCcw size={16} /></button>
                <button className="text-button" type="button" onClick={clearSequence} disabled={!sequence.length || game.busy} data-testid="button-sequence-clear">Clear</button>
              </div>
              <button
                className="primary-button submit-sequence"
                type="button"
                disabled={sequence.length !== 4 || game.busy || !game.room.roundId || game.connection !== 'connected'}
                onClick={() => game.room?.roundId && game.submitSequence(game.room.roundId, sequence)}
                data-testid="button-submit-sequence"
              >
                <span>{game.busy ? 'Sending signal…' : 'Submit sequence'}</span>
                <ArrowRight size={17} />
              </button>
              {game.submission && (
                <div className="submission-note" role="status" data-testid="status-submission-feedback">
                  <span className="feedback-led" />
                  Attempt received · {game.submission.attemptsRemaining ?? game.room.attemptsRemaining} attempts remaining
                </div>
              )}
            </section>
            <RulesNote />
          </div>
          <aside className="game-rail">
            <div className="rail-room-card">
              <div className="rail-topline"><span className="mini-wave"><span /><span /><span /><span /></span> ROOM CHANNEL</div>
              <div className="rail-room-code">{game.room.roomCode}</div>
              <div className="rail-room-meta"><Users size={13} /> {game.room.players.length} linked players</div>
            </div>
            {chatContents}
            <div className="rail-players">
              <div className="rail-section-title"><span>IN THIS ROOM</span><span>{game.room.players.length}</span></div>
              {game.room.players.map((player) => <PlayerLine key={player.id} player={player} isMe={player.id === game.playerId} isHost={player.id === game.room?.hostPlayerId} />)}
              <button type="button" className="leave-link" onClick={game.leaveRoom} data-testid="button-leave-room"><DoorOpen size={14} /> Leave room</button>
            </div>
          </aside>
        </section>
      )}

      {game.room && (phase === 'won' || phase === 'lost') && (
        <ResultScreen
          room={game.room}
          isHost={isHost}
          busy={game.busy}
          onRematch={game.rematch}
          onLeave={game.leaveRoom}
        />
      )}

      {!game.room && <Footer />}
    </main>
  );
}

function Landing({ name, code, onNameChange, onCodeChange, onCreate, onJoin, busy, connection }: {
  name: string;
  code: string;
  onNameChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onCreate: () => void;
  onJoin: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  connection: string;
}) {
  return (
    <section className="landing-layout">
      <div className="landing-copy rise-in">
        <div className="eyebrow"><span className="eyebrow-dot" /> TWO MINDS. ONE SIGNAL.</div>
        <h1>Decode what<br />you <em>can't see.</em></h1>
        <p className="landing-lede">Each of you holds a fragment. Bring the clues together, read between the lines, and crack the four-symbol signal before the channel goes dark.</p>
          <div className="signal-illustration" aria-label="Four geometric signal symbols">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          {signalSymbols.slice(0, 4).map((symbol, index) => <div className={`orbit-symbol orbit-symbol-${index + 1}`} key={symbol.id}><SignalGlyph symbol={symbol.glyph} size={index === 1 ? 31 : 25} /></div>)}
          <span className="illustration-center"><Radio size={24} /></span>
          <span className="orbit-label label-top">FREQUENCY 04</span>
          <span className="orbit-label label-bottom">SIGNAL FOUND / UNKNOWN</span>
        </div>
        <div className="landing-metrics">
          <div><strong>02—06</strong><span>OPERATORS</span></div>
          <div><strong>01:15</strong><span>PER ROUND</span></div>
          <div><strong>04</strong><span>SYMBOLS TO DECODE</span></div>
        </div>
      </div>
      <div className="entry-panel rise-in-delay">
        <div className="entry-kicker"><span className="entry-led" /> ESTABLISH UPLINK</div>
        <h2>Get your crew<br />on the same <em>wavelength.</em></h2>
        <label className="field-label" htmlFor="player-name">CALLSIGN</label>
          <input id="player-name" className="text-input" value={name} onChange={(event) => onNameChange(event.target.value.slice(0, 18))} placeholder="How should we identify you?" maxLength={18} data-testid="input-player-name" />
        <button className="primary-button create-button" type="button" onClick={onCreate} disabled={busy || connection !== 'connected' || !name.trim()} data-testid="button-create-room">
          <span>{busy ? 'Opening channel…' : 'Create a room'}</span>
          <ArrowRight size={17} />
        </button>
        <div className="join-divider"><span /> <span>OR JOIN AN EXISTING ROOM</span> <span /></div>
        <form className="join-form" onSubmit={onJoin}>
          <label className="field-label" htmlFor="room-code">ROOM CODE</label>
          <div className="join-row">
             <input id="room-code" className="text-input code-input" value={code} onChange={(event) => onCodeChange(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))} placeholder="E.G. 7KQ2" maxLength={4} data-testid="input-room-code" />
            <button className="join-button" type="submit" disabled={busy || connection !== 'connected' || !name.trim() || !code.trim()} data-testid="button-join-room" aria-label="Join room"><ArrowRight size={18} /></button>
          </div>
        </form>
        <p className="entry-footnote"><Shield size={13} /> No accounts. Just a room code and your crew.</p>
      </div>
      <div className="landing-rule"><div className="rule-icon"><Sparkles size={15} /></div><div><b>HOW THE SIGNAL WORKS</b><span>Private clues are fragments, never the answer. Your team's conversation is the decoder.</span></div><ArrowDown size={15} /></div>
    </section>
  );
}

function Lobby({ room, playerId, isHost, canStart, busy, copied, onCopy, onStart, onLeave }: {
  room: RoomSnapshot;
  playerId: string | null;
  isHost: boolean;
  canStart: boolean;
  busy: boolean;
  copied: boolean;
  onCopy: () => void;
  onStart: () => void;
  onLeave: () => void;
}) {
  const connectedCount = room.players.filter((player) => player.connected).length;
  return (
    <section className="lobby-layout rise-in" data-testid="screen-lobby">
      <div className="lobby-main">
        <div className="eyebrow"><span className="eyebrow-dot" /> ROOM ASSEMBLY <span className="eyebrow-sep">/</span> PRE-FLIGHT</div>
        <h1>Make contact.<br /><em>Share the signal.</em></h1>
        <p className="subhead lobby-subhead">Invite your people into the room. The signal starts when everyone's connected.</p>
        <div className="room-code-panel">
          <div><span className="micro-label">YOUR ROOM CODE</span><strong data-testid="text-room-code">{room.roomCode}</strong></div>
          <button className="copy-button" type="button" onClick={onCopy} data-testid="button-copy-room-code"><span>{copied ? <Check size={15} /> : <Copy size={15} />}</span>{copied ? 'Copied' : 'Copy code'}</button>
        </div>
        <div className="roster-heading"><div><span className="section-index">01</span><h2>Operator roster</h2></div><span className="roster-count" data-testid="text-player-count">{room.players.length} <i>/ 6</i></span></div>
        <div className="roster-list" data-testid="list-room-players">
          {room.players.map((player) => (
            <div className="roster-person" key={player.id} data-testid={`row-player-${player.id}`}>
              <div className={`player-avatar ${player.id === playerId ? 'avatar-me' : ''}`}><span>{player.name.slice(0, 1).toUpperCase()}</span><i className={player.connected ? 'connected' : ''} /></div>
              <div className="roster-name"><strong>{player.name}{player.id === playerId ? <span className="you-tag">YOU</span> : null}</strong><span>{player.id === room.hostPlayerId ? 'Room host' : 'Operator'}</span></div>
              {player.id === room.hostPlayerId && <span className="host-badge"><Crown size={13} /> HOST</span>}
              <span className={`connection-label ${player.connected ? 'online' : ''}`}><span />{player.connected ? 'Connected' : 'Reconnecting'}</span>
            </div>
          ))}
          {room.players.length < 6 && <div className="roster-open-slot"><div className="open-slot-plus">+</div><span>Waiting for {room.players.length < 2 ? 'your crew' : 'another operator'} to join</span><span className="slot-count">{6 - room.players.length} OPEN</span></div>}
        </div>
        <div className="ready-check">
          <div className={`ready-icon ${canStart ? 'ready-yes' : ''}`}>{canStart ? <Check size={18} /> : <Wifi size={17} />}</div>
          <div><strong>{canStart ? 'Crew is ready.' : room.players.length < 2 ? 'Your crew is not complete yet.' : 'Waiting on a connection.'}</strong><span>{connectedCount} of {room.players.length} operators linked · minimum crew of 2</span></div>
          <span className="ready-state">{canStart ? 'READY' : 'STANDBY'}</span>
        </div>
        {isHost ? (
          <button className="primary-button start-button" type="button" onClick={onStart} disabled={!canStart || busy} data-testid="button-start-game"><span>{busy ? 'Starting…' : 'Start decoding'}</span><ArrowRight size={17} /></button>
        ) : (
          <div className="host-wait" data-testid="status-host-wait"><span className="signal-pulse"><Radio size={17} /></span> The host will start the signal when the crew is ready.</div>
        )}
        <button className="leave-link lobby-leave" type="button" onClick={onLeave} data-testid="button-leave-room"><ArrowLeft size={14} /> Leave room</button>
      </div>
      <aside className="lobby-aside">
        <div className="protocol-card">
          <div className="protocol-top"><span>PROTOCOL 001</span><span className="protocol-light" /></div>
          <h3>One team.<br />One four-part<br /><em>signal.</em></h3>
          <div className="protocol-symbols">{signalSymbols.map((symbol) => <span key={symbol.id}><SignalGlyph symbol={symbol.id} size={18} /></span>)}</div>
          <div className="protocol-line" />
          <p>Each operator receives private evidence. Share clues aloud in chat, find the pattern, and enter the sequence before the timer hits zero.</p>
          <div className="protocol-stats"><span><Clock3 size={13} /> 75 seconds</span><span><RotateCcw size={13} /> 3 attempts</span></div>
        </div>
        <div className="lobby-note"><LockKeyhole size={14} /><span>Keep your clues to yourself until the game begins. The challenge is combining what no single person can see.</span></div>
      </aside>
    </section>
  );
}

function ChatPanel({ messages, playerId, value, onChange, onSubmit, disabled }: {
  messages: RoomMessage[];
  playerId: string | null;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  disabled: boolean;
}) {
  return (
    <div className="chat-panel" data-testid="panel-room-chat">
      <div className="chat-heading"><div><MessageSquareText size={15} /><span>Room channel</span></div><span className="channel-live"><span /> LIVE</span></div>
      <div className="chat-messages" data-testid="list-chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty" data-testid="status-chat-empty"><div className="chat-empty-mark"><Signal size={18} /></div><strong>Channel is clear.</strong><span>Share your clue when you're ready.</span></div>
        ) : messages.map((message) => (
          <article className={`chat-message ${message.playerId === playerId ? 'message-mine' : ''}`} key={message.id} data-testid={`message-chat-${message.id}`}>
            <div className="message-meta"><strong>{message.playerName}{message.playerId === playerId ? ' · YOU' : ''}</strong><time>{formatTime(message.createdAt)}</time></div>
            <p>{message.message}</p>
          </article>
        ))}
      </div>
      <form className="chat-compose" onSubmit={onSubmit}>
        <input value={value} onChange={(event) => onChange(event.target.value.slice(0, 240))} placeholder="Transmit a thought…" aria-label="Room message" maxLength={240} disabled={disabled} data-testid="input-chat-message" />
        <button type="submit" disabled={disabled || !value.trim()} aria-label="Send message" data-testid="button-send-chat"><Send size={15} /></button>
      </form>
      <div className="chat-hint"><CornerDownLeft size={11} /> SHARE CLUES, NOT GUESSES</div>
    </div>
  );
}

function PlayerLine({ player, isMe, isHost }: { player: { id: string; name: string; connected: boolean }; isMe: boolean; isHost: boolean }) {
  return (
    <div className="rail-player" data-testid={`rail-player-${player.id}`}>
      <div className={`rail-avatar ${isMe ? 'avatar-me' : ''}`}>{player.name.slice(0, 1).toUpperCase()}<i className={player.connected ? 'connected' : ''} /></div>
      <span>{player.name}{isMe ? ' (you)' : ''}</span>
      {isHost && <Crown size={12} className="rail-crown" />}
    </div>
  );
}

function RulesNote() {
  return (
    <div className="rules-note" data-testid="status-rules">
      <div className="rules-icon"><Sparkles size={15} /></div>
      <div><strong>THE SIGNAL IS SHARED. THE CLUES AREN'T.</strong><p>Describe your evidence in your own words. No one sees the answer until the round ends—only the team's combined reasoning can get you there.</p></div>
    </div>
  );
}

function ResultScreen({ room, isHost, busy, onRematch, onLeave }: {
  room: RoomSnapshot;
  isHost: boolean;
  busy: boolean;
  onRematch: () => void;
  onLeave: () => void;
}) {
  const won = room.phase === 'won';
  const answer = room.result?.answer ?? [];
  const resultMessage = room.result?.reason === 'timeout'
    ? 'Time ran out before the team could finish the sequence.'
    : room.result?.reason === 'attempts'
      ? 'The team used all three attempts. Compare your clues and try again.'
      : 'The team brought every fragment together.';
  return (
    <section className={`result-layout rise-in ${won ? 'result-won' : 'result-lost'}`} data-testid="screen-result">
      <div className="result-eyebrow"><span className={`result-indicator ${won ? '' : 'result-indicator-lost'}`} /> ROUND {String(room.roundNumber).padStart(2, '0')} COMPLETE <span>/</span> {won ? 'SIGNAL DECODED' : 'CHANNEL CLOSED'}</div>
      <div className="result-emblem">{won ? <Check size={34} /> : <Signal size={34} />}</div>
      <h1>{won ? <>You found<br /><em>the signal.</em></> : <>Signal<br /><em>lost.</em></>}</h1>
       <p className="result-summary">{resultMessage}</p>
      <div className="answer-panel" data-testid="result-answer">
        <span className="micro-label">THE FOUR-PART SIGNAL</span>
        <div className="answer-sequence">
          {answer.length ? answer.map((symbol, index) => <div className="answer-symbol" key={`${symbol}-${index}`}><span>0{index + 1}</span><SignalGlyph symbol={symbol} size={25} /></div>) : <span className="answer-unavailable">Answer not supplied</span>}
        </div>
      </div>
      <div className="result-score">
        <div><span className="micro-label">TEAM SCORE</span><strong>{room.score}</strong></div>
        {room.result && <div><span className="micro-label">ROUND CHANGE</span><strong className={room.result.scoreDelta >= 0 ? 'score-positive' : 'score-negative'}>{room.result.scoreDelta > 0 ? '+' : ''}{room.result.scoreDelta}</strong></div>}
        <div><span className="micro-label">OPERATORS</span><strong>{room.players.length}</strong></div>
      </div>
      {isHost ? (
        <button className="primary-button rematch-button" type="button" onClick={onRematch} disabled={busy} data-testid="button-rematch"><span>{busy ? 'Resetting channel…' : 'Run it back'}</span><RotateCcw size={16} /></button>
      ) : (
        <div className="host-wait result-wait" data-testid="status-rematch-wait"><span className="signal-pulse"><Radio size={17} /></span> Waiting for the host to start a rematch.</div>
      )}
      <button type="button" className="leave-link result-leave" onClick={onLeave} data-testid="button-leave-room"><DoorOpen size={14} /> Leave room</button>
    </section>
  );
}

function Footer() {
  return (
    <footer className="page-footer">
      <span>RELAY ZERO <b>·</b> A COOPERATIVE SIGNAL GAME</span>
      <span>STAY SHARP. STAY IN SYNC.</span>
    </footer>
  );
}

function formatTime(value: string | number) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ErrorBoundary>
          <AppShell />
        </ErrorBoundary>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
