"""
    This file contains the routing for the Pong game.
"""
from django.urls import re_path
from .consumers import PongConsumer

websocket_urlpatterns = [
    re_path(r"ws/game/(?P<player_name>\w+)/$", PongConsumer.as_asgi()),
]
