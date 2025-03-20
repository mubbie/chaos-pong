"""
    This file contains the consumer for the Pong game.
    It handles the websocket connections for the game.
"""
import json
import asyncio
from channels.generic.websocket import AsyncWebsocketConsumer

class PongConsumer(AsyncWebsocketConsumer):
    """Handles Websocket connections for the Pong game.

    Args:
        AsyncWebsocketConsumer: Consumer for websocket connections.
    """
    lobby = [] # list of player waiting to play
    
    async def connect(self):
        """Called when a client connects to the websocket.

           - Get the player's name from the query string.
           - Add the player to the lobby.
           - If there are at least two players in the lobby, start a new game.
        """
        #TODO: fix init error
        self.player_name = self.scope["url_route"]["kwargs"]["player_name"]
        await self.accept()
        # add the player to the lobby
        PongConsumer.lobby.append(self)
        print(f"{self.player_name} connected to the lobby.")
        # match players
        await self.match_players()
        
    async def disconnect(self, code):
        #TODO: utilize close_code
        """Called when a client disconnects from the websocket.

           - Remove the player from the lobby.
           - If the player was in a game, end the game.

        Args:
            close_code: Reason for the disconnection.
        """
        if self in PongConsumer.lobby:
            PongConsumer.lobby.remove(self)  # Remove player from lobby
        #TODO: End the game if the player was in a game
        print(f"{self.player_name} disconnected.")
        
    async def receive(self, text_data=None, bytes_data=None):
        """Called when the server receives a message from the client.

        Args:
            text_data: Details/action to perform
            bytes_data: Binary data received
        """
        if text_data:
            data = json.loads(text_data)
            # log the action
            if data["action"] == "game_result":
                print(f"Game Over. Winner: {data['winner']}")
        
    async def match_players(self):
        """Pair two players for a game if available
        """
        if len(PongConsumer.lobby) >= 2:
            # get players 
            player1 = PongConsumer.lobby.pop(0)
            player2 = PongConsumer.lobby.pop(0)

            # assign a game room
            game_room = f"game_{player1.player_name}_{player2.player_name}"
            # notify players that they have been matched
            await player1.send(text_data=json.dumps({
                "action": "start_game",
                "opponent": player2.player_name,
                "game_room": game_room
            }))
            await player2.send(text_data=json.dumps({
                "action": "start_game",
                "opponent": player1.player_name,
                "game_room": game_room
            }))
            # log the match
            print(f"Matched {player1.player_name} and {player2.player_name} in {game_room}")
            