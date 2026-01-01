FROM registry.fedoraproject.org/fedora-minimal:43
WORKDIR /usr/src/app
RUN dnf in -y --setopt=max_parallel_downloads=20 --setopt=install_weak_deps=0 npm rpmspec
COPY . .
RUN npm ci --omit=dev && \
    npm i -g typescript && npm run build && npm uninstall -g typescript && \
    npm cache clean --force
ENV NODE_ENV="production"
CMD [ "npm", "start" ]
