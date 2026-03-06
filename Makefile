.PHONY: run build clean client-dev client-build client-install

run:
	cd backend && go run main.go

build:
	cd backend && go build -o ../bin/chaos-pong main.go

clean:
	rm -rf bin/ client/dist/

client-install:
	cd client && npm install

client-dev:
	cd client && npx vite

client-build:
	cd client && npx vite build
